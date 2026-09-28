# Arquitetura

Este documento descreve a fundação técnica atual e as regras que permitem
evoluir para um FPS competitivo online (servidor autoritativo, ranked,
matchmaking, contas, anti-cheat) sem reescrever a base. Descreve também
onde os sistemas futuros vão encaixar, sem os implementar.

## Princípios

1. **Simulação separada da apresentação.** O estado de jogo evolui em ticks
   fixos (64 Hz). A renderização acontece a cada frame do ecrã e interpola
   entre ticks. É o pré-requisito para predição no cliente, reconciliação
   com o servidor e replays.
2. **Código partilhado sem motor nem DOM.** `src/shared` contém só lógica e
   dados puros (TypeScript + ES2023). Um servidor autoritativo em Node pode
   executá-lo sem alterações. `tsconfig.shared.json` compila esta pasta sem
   a lib DOM, portanto qualquer uso de `window`, `document`, `performance`
   etc. falha no typecheck.
3. **Composition root explícito.** `ClientApp` cria e liga todos os serviços.
   Não há singletons nem estado global escondido. Dependências entram por
   construtor ou opções.
4. **Ciclo de vida explícito.** Tudo o que aloca recursos de GPU/DOM tem um
   dono e um `dispose()`. A destruição é feita por ordem inversa da criação.
5. **Falhar de forma visível.** Erros de arranque ou de frame param o loop e
   mostram um ecrã de erro. Nunca ficam 144 exceções por segundo na consola.

## Camadas e dependências

```
main.ts ──► client/app ──► client/{core, input, player, rendering, world, debug}
                 │                                     │
                 └────────────────► shared ◄───────────┘
```

- `shared` → não depende de nada do projeto (nem de Three.js).
- `client/core` → só `shared`. Loop, scheduler e contrato de sistemas.
- `client/rendering` → Three.js + `client/core`.
- `client/world` → `rendering` + `shared/maps`. Converte dados do mapa em malhas.
- `client/input` → `client/core` + `shared/input`. Não conhece o renderer, e o
  renderer não conhece o input.
- `shared/player` → `shared/{input, physics, math}`. A simulação do jogador não
  conhece DOM, Three.js nem o cliente.
- `client/player` → `shared/player` + a câmara Three.js (apresentação).
- `client/app` → junta tudo. É o único sítio que conhece todas as peças.

## Game loop e fases

`GameLoop` (client/core) é acionado por `requestAnimationFrame` e usa
`FixedTimestep` (shared) para converter tempo real em ticks fixos. Em cada
frame, os sistemas registados no `SystemScheduler` recebem as fases por esta
ordem (e, dentro de cada fase, pela ordem de registo):

| Fase          | Frequência         | Uso previsto                                                  |
| ------------- | ------------------ | ------------------------------------------------------------- |
| `beginFrame`  | 1× por frame       | amostrar input e mensagens de rede antes de simular           |
| `fixedUpdate` | 0..n× por frame    | simulação determinística (movimento, armas, regras)           |
| `update`      | 1× por frame       | apresentação: interpolação (`frame.alpha`), câmara, UI        |
| `render`      | 1× por frame       | submeter o frame à GPU                                        |
| `endFrame`    | 1× por frame       | diagnóstico e contabilidade                                   |

Proteções do loop:
- delta de frame limitado a 0,25 s (separador em segundo plano, breakpoint);
- no máximo 8 ticks por frame, e o atraso acima disso é descartado (evita a "spiral of death");
- uma exceção num frame para o loop e é reportada uma única vez.

Sistemas atuais, por ordem: `DebugOverlay` (primeiro, para medir o frame
inteiro), `InputSystem`, `InputDebugPanel` (temporário), `LocalPlayerSystem`,
`PlayerDebugPanel` (temporário), `FirstPersonCamera`, `Viewport`,
`GameRenderer`. A simulação vem sempre depois do `InputSystem`, para que o
comando do tick já exista quando é lido.

## Renderização

- **Renderer:** `WebGPURenderer` de Three.js (`three/webgpu`). Usa WebGPU quando
  existe e WebGL 2 caso contrário, com o mesmo código de cena.
- **Materiais:** node materials / TSL, que compilam para WGSL (WebGPU) e GLSL
  (WebGL 2). O material graybox desenha uma grelha procedural em espaço de
  mundo (1 m / 4 m) sem texturas nem UVs.
- **Estratégia de fallback (em camadas):**
  1. Sem WebGPU no browser → o próprio Three.js inicializa em WebGL 2.
  2. WebGPU existe mas falha ao desenhar → `GameRenderer.create` compila a cena
     real e desenha um frame de validação. Se falhar, repete com WebGL 2 num
     canvas novo (um canvas fica preso ao primeiro tipo de contexto).
  3. Dispositivo WebGPU perdido durante o jogo → `main.ts` reconstrói o cliente
     uma vez em WebGL 2. Qualquer outra perda mostra o ecrã de erro.
  4. Nem WebGPU nem WebGL 2 → ecrã de erro com uma mensagem clara.
- **Resize:** `Viewport` observa o elemento host (`ResizeObserver`) e as
  mudanças de devicePixelRatio (media query de resolução). As mudanças são
  agrupadas e aplicadas no início do frame seguinte. O pixel ratio tem um
  limite configurável (2 por defeito).
- **Câmara:** FOV vertical fixo derivado de um FOV horizontal a 16:9 ("Hor+"):
  ecrãs mais largos veem mais para os lados e nunca menos na vertical.
- **Pipelines** são compiladas no arranque (`compileAsync`), para evitar
  engasgos de compilação de shaders nos primeiros frames.

## Input

O gameplay recebe apenas `InputCommand`: um objeto imutável por tick, igual
para teclado/rato, touch ou gamepad. Nunca vê `KeyboardEvent`, `MouseEvent`
ou `TouchEvent`.

```
Dispositivo ─► Adapter ─► InputState ─► InputCommandBuilder ─► InputCommandBuffer ─► gameplay
(browser)      (mapeia)   (agrega)      (quantiza, 1 por tick)   (histórico por tick)   commands.get(tick)
```

| Camada | Ficheiros | Responsabilidade |
| ------ | --------- | ---------------- |
| Dispositivo | `client/input/devices/` | Eventos do browser, Pointer Lock, focus/visibility. Emite identificadores físicos (`KeyW`, `left`) sem significado de jogo. |
| Adapter | `client/input/adapters/` | Mapeia o dispositivo para input abstrato através de bindings (dados) e sensibilidade. Escreve num `InputPort`. |
| Estado | `client/input/InputState.ts` | Agrega todas as fontes: ações seguras, movimento analógico, look acumulado ou por taxa. Regista as pressões no momento em que acontecem. |
| Comando | `client/input/InputCommandBuilder.ts`, `shared/input/` | Uma amostra por tick → `InputCommand` quantizado e congelado. |
| Consumo | `InputSystem.commands` | `InputCommandSource.get(tick)`, lido no `fixedUpdate` do gameplay. |

### InputCommand (`shared/input/InputCommand.ts`)

| Campo | Significado | Grelha (determinismo / rede) |
| ----- | ----------- | ---------------------------- |
| `tick` | tick de simulação a que se aplica | inteiro ≥ 0 |
| `moveX`, `moveY` | intenção de movimento; +X direita, +Y frente; vetor no disco unitário | múltiplos de 1/127 (int8) |
| `lookX`, `lookY` | rotação neste tick, em radianos; +X direita, +Y cima | múltiplos de 2⁻¹⁶ rad |
| `held` | ações seguras no momento da amostra (contínuo: sprint, crouch, fogo automático) | bitmask |
| `pressed` | ações que desceram neste tick, incluindo toques mais curtos que um tick (one-shot: jump, reload) | bitmask |

- A ordem de `INPUT_ACTIONS` define o bit de cada ação e faz parte do formato
  de rede: acrescentar no fim, nunca reordenar.
- Os valores são quantizados quando o comando é criado. O cliente simula
  exatamente com os valores que um servidor vai receber. O resto sub-quantum
  do look passa para o tick seguinte, por isso nenhum movimento de rato se
  perde.
- O mesmo input, com o mesmo timing de frames, produz sempre os mesmos
  comandos (há testes para isto). `-0` é normalizado para `0`, e usa-se
  `Math.sqrt` em vez de `Math.hypot` porque o resultado é exato por especificação.
- Todos os ticks têm comando. Sem input (ou sem captura) o comando é neutro.
- Num frame lento que corre vários ticks, o look acumulado e as pressões vão
  para o primeiro tick. As ações seguras e o movimento mantêm-se nos seguintes.

### Captura e inputs presos (desktop)

- Captura = Pointer Lock no elemento raiz do jogo (clique para capturar, `Esc`
  liberta). Pede-se movimento raw (`unadjustedMovement`). Se não for
  suportado, usa-se o pointer lock normal.
- Sem captura, nenhum input chega ao gameplay. O clique que captura não conta
  como `fire`.
- Tudo é libertado ao perder a captura, ao perder o focus (`blur`), ao
  esconder o separador, e ao soltar ⌘ no macOS (que não envia os keyup das
  outras teclas). Um input seguro durante a perda tem de ser pressionado de
  novo.
- O estado de captura segue `document.pointerLockElement` em cada evento: o
  browser atualiza-o antes de entregar `pointerlockchange`.
- Com captura: auto-repeat ignorado, `preventDefault` em todas as teclas exceto
  `Esc` e F1–F12, menu de contexto bloqueado, e pedido de confirmação antes de
  sair da página (o browser não deixa intercetar Ctrl+W).
- As teclas usam `KeyboardEvent.code` (posição física): WASD fica no mesmo
  sítio em AZERTY/QWERTZ.

### Adicionar Touch (ou gamepad)

O `InputPort` já cobre o que os controlos mobile precisam:

| Controlo touch | Chamada no `InputPort` |
| -------------- | ---------------------- |
| joystick virtual esquerdo | `setMove(x, y)` (analógico, com deadzone/curva no adapter) |
| joystick de câmara direito | `setLookRate(yawRate, pitchRate)`, integrado por tick |
| arrastar para olhar | `addLook(yaw, pitch)` |
| botões fire / aim / crouch / jump / reload | `press(action)` / `release(action)` |
| `touchcancel`, UI escondida | `releaseAll()` |

Basta um dispositivo `devices/` (a UI touch em DOM), um `TouchAdapter` e
`input.addAdapter('touch', (port) => new TouchAdapter(port, …))` no
`ClientApp`. Várias fontes podem coexistir (teclado + touch num tablet). Uma
ação está segura enquanto qualquer fonte a segurar, e o movimento é somado e
limitado ao disco unitário. O gameplay não muda. Um gamepad usa o mesmo
caminho, lido no `poll()` do adapter (Gamepad API).

## Player Controller

```
InputCommand ─► simulatePlayerTick(estado anterior, comando, contexto) ─► PlayerState ─► FirstPersonCamera ─► render
                (shared/player: pura e determinística)                    (dados)        (client: apresentação)
```

`simulatePlayerTick` recebe apenas o estado anterior, o `InputCommand`, o
`CollisionWorld`, a configuração e o delta fixo do tick. Não muta nada e
devolve um `PlayerState` novo e congelado. Por isso, o mesmo estado inicial
com os mesmos comandos dá sempre o mesmo resultado, bit a bit (há testes para
isto). É a base da futura predição no cliente: guardar (comando, estado) por
tick e, quando chegar uma correção do servidor, voltar a simular a partir
dela. O servidor corre a mesma função. O seno e o cosseno do yaw usam
`shared/math/deterministicTrig.ts`: só +, −, ×, ÷ e `Math.round`, porque os
resultados de `Math.sin`/`Math.cos` podem diferir entre motores JavaScript.

| Ficheiro (`shared/player/`) | Responsabilidade |
| --- | --- |
| `PlayerState.ts` | estado completo e serializável (posição dos pés, velocidade, yaw/pitch, grounded, crouched, crouchAmount, sprinting, jump buffer); hull e altura dos olhos |
| `PlayerMovementConfig.ts` | todos os valores de tuning, documentados um a um |
| `look.ts` | yaw livre (com wrap) e pitch limitado |
| `horizontal.ts` | velocidade desejada (vetor limitado ao disco unitário), aceleração no chão e controlo no ar |
| `vertical.ts` | gravidade (cinemática exata) e jump buffer |
| `crouch.ts` | agachar e levantar, com verificação de espaço |
| `kinematics.ts` | collide-and-slide por eixo, subir degraus e sonda de chão |
| `PlayerController.ts` | ordem das fases dentro de um tick |

### Valores iniciais (`DEFAULT_PLAYER_MOVEMENT`)

| Parâmetro | Valor | Consequência a 64 Hz |
| --- | --- | --- |
| hull | 0,6 × 1,8 m (agachado 1,3 m) | passa em aberturas de 0,65 m e em túneis de 1,5 m agachado |
| olhos | 1,62 m / 1,12 m (0,18 m abaixo do topo) | agachar no ar não mexe a vista |
| walk / sprint / crouch | 4,8 / 6,4 / 1,9 m/s | 10 s para atravessar a arena; sprint +33 %; crouch 40 % |
| sprint | só com ≥ 0,5 de componente para a frente (≤ 60°) | W e W+A/D fazem sprint; strafe puro e recuar não fazem |
| aceleração no chão | 50 m/s² | 0 → 4,8 m/s em 7 ticks (0,11 s) |
| desaceleração no chão | 70 m/s² | 4,8 → 0 em 5 ticks (0,08 s, < 0,2 m) |
| controlo no ar | 5 m/s² | ~3 m/s de correção por salto; nunca ganha velocidade |
| gravidade / salto | 20 m/s², 1,0 m | impulso √(2gh) = 6,32 m/s; 0,64 s no ar |
| jump buffer | 0,1 s (6 ticks) | um salto premido pouco antes de aterrar não se perde |
| degrau | 0,35 m | escadas e lancis sem saltar; 0,5 m obriga a saltar |
| pitch | ±89° | |

Estes são valores de partida para afinar, não definitivos. Os testes
verificam as consequências (por exemplo, tempo até à velocidade máxima)
calculadas a partir da configuração.

### Movimento horizontal

- A direção do input é limitada ao disco unitário: W+D é normalizado e não é
  mais rápido que W. Um stick analógico a meio pede metade da velocidade.
- **No chão**, a velocidade aproxima-se da velocidade desejada em linha reta,
  a ritmo constante. Acelera a 50 m/s². Parar, travar contra o movimento ou
  perder velocidade acima do limite é a 70 m/s². Como a aproximação é em linha
  reta, a velocidade nunca ultrapassa max(atual, limite da postura).
- **No ar**, sem input, o momento mantém-se. Com input, a velocidade é
  orientada para a direção desejada à velocidade atual (ou ao limite, se for
  maior). Dá para corrigir e travar, mas não há strafe-jumping nem bunny-hop
  que acrescentem velocidade.
- **Contra uma parede**, conta só a parte do input paralela à parede, que
  acelera ao ritmo normal. Não se perde aceleração no eixo bloqueado.

### Colisão (`shared/physics/`)

O jogador é uma caixa (AABB) e o mapa é feito de caixas, por isso a colisão é
exata sem motor de física:

- O movimento é varrido um eixo de cada vez contra todos os sólidos
  (`CollisionWorld.sweep`). Não há túneis a nenhuma velocidade, e a
  componente paralela a uma parede mantém-se (deslizar).
- O eixo com maior deslocamento vai primeiro, o que torna natural contornar
  cantos exteriores.
- Uma tolerância de contacto de 1 µm faz com que tocar numa superfície não
  seja intersetar. Por isso, estar pousado no chão, deslizar por uma parede ou
  passar por juntas entre caixas nunca prende.
- **Degraus:** se o movimento no chão ficar bloqueado, repete-se levantado até
  0,35 m e desce-se depois. Só é aceite se chegar mais longe. Paredes mais
  altas que um degrau continuam a bloquear, por isso não se trepam paredes.
- **Salvaguarda:** no início de cada tick, se o hull estiver dentro de
  geometria (spawn, teleporte, futura correção de rede), é empurrado para fora
  pelo eixo mais curto.
- Rapier não foi necessário. Faz sentido quando houver geometria não-AABB
  (rampas, malhas) ou corpos dinâmicos.

### Grounded

- Depois de mover, faz-se uma sonda de chão para baixo. Se estiver a subir,
  nunca está grounded.
- A andar (grounded no tick anterior e sem saltar), a sonda chega aos 0,35 m:
  descer degraus e lancis mantém o contacto com o chão. Uma queda maior
  deixa-o no ar.
- No ar, a sonda só chega a 1 cm. O jogador aterra exatamente na superfície
  (y do topo) e a velocidade vertical passa a 0.
- Parado no chão não há acumulação de gravidade nem deriva: a posição fica
  bit a bit igual.

### Crouch

- O hull muda de imediato; a altura dos olhos muda em 0,12 s. A velocidade
  máxima passa a 1,9 m/s.
- **No chão:** os pés ficam no sítio e o topo desce.
- **No ar (ou no tick do salto):** a cabeça fica no sítio e as pernas
  encolhem 0,5 m. É o crouch-jump, que chega a 1,2 m. Como os olhos estão a
  0,18 m do topo nas duas posturas, a vista não se mexe.
- **Levantar** exige espaço livre para o hull de pé. No ar tenta-se primeiro
  estender as pernas para baixo e depois subir a cabeça. Sem espaço (túnel de
  1,5 m), o jogador fica agachado e levanta-se sozinho quando houver espaço.
  Levantar nunca empurra o jogador para dentro de um teto.

### Jump e gravidade

- Salta-se só se estava grounded no início do tick e houve um *press* (não
  basta ter a tecla segura). Não há duplo salto nem auto-jump.
- Há um jump buffer de 6 ticks: um press pouco antes de aterrar salta logo no
  primeiro tick no chão.
- A gravidade usa cinemática exata (Δy = v·dt − ½·g·dt²), por isso o apex é o
  configurado a qualquer tick rate.
- Um teto corta a subida (velocidade vertical 0) e o jogador cai.

### Câmara (`client/player/FirstPersonCamera.ts`)

É só apresentação: lê estados e nunca escreve na simulação.
- A posição dos olhos é interpolada entre os dois últimos ticks
  (`frame.alpha`). O movimento é igualmente suave a 60, 144 ou 240 Hz (há um
  teste por frame).
- A orientação é o yaw/pitch do último tick mais o look ainda não enviado
  num comando (`InputSystem.previewLook`). A mira responde à taxa do ecrã sem
  esperar pelo tick seguinte, e esse tick aplica a mesma rotação. O pitch usa
  o mesmo limite da simulação.
- Subidas e descidas de degraus são suavizadas na vertical (4 m/s), em vez de
  saltarem num tick. As aterragens não são suavizadas.

### Área de teste

A leste da arena, atrás de uma porta, há um laboratório de movimento só para
desenvolvimento:
- obstáculos de 0,2 / 0,35 / 0,5 / 0,9 / 1,2 / 1,6 m;
- escadas até uma plataforma de 1,5 m;
- corredor de 1,2 m;
- aberturas de 0,65 m e 0,55 m;
- túnel com teto a 1,5 m e uma pala a 2,2 m.

A porta tem 2,4 m de altura. `?spawn=x,y,z,yaw` coloca o jogador em qualquer
ponto, para testes reproduzíveis.

## Mapas

`MapDefinition` (shared) descreve a geometria estática como dados puros:
caixas alinhadas aos eixos, em metros, e os pontos de spawn. O mesmo formato
alimenta a renderização e a colisão (`CollisionWorld.fromMap`), e vai
alimentar o servidor. `MapView` (client)
é apenas uma vista: um único `BoxGeometry` unitário escalado por sólido e um
material por tipo de sólido.

## Onde entram os sistemas futuros

Input, Player e a colisão já existem. O resto indica apenas onde cada sistema
deve viver quando for pedido.

| Sistema      | Lógica partilhada (`src/shared`)                     | Cliente (`src/client`)                                     |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------- |
| Input        | ✅ implementado: `shared/input/`                      | ✅ `input/`: teclado + rato. Falta touch e gamepad (ver [Input](#input)) |
| Player       | ✅ `shared/player/`: movimento determinístico           | ✅ `player/`: simulação local e câmara em 1ª pessoa        |
| Weapons      | dados e regras de armas, hitscan                     | `weapons/`: viewmodels, efeitos                            |
| Gameplay     | regras de ronda/modo, estado de jogo                 | ligação do estado à apresentação                           |
| Physics      | ✅ `shared/physics/`: colisão AABB exata (sem Rapier)   | depuração visual                                           |
| Networking   | protocolo, serialização, relógio de ticks            | `net/`: transporte; predição = reexecutar `simulatePlayerTick` a partir da correção |
| Audio        | —                                                    | `audio/`: Web Audio, som posicional                        |
| UI           | —                                                    | `ui/`: HUD e menus em DOM, por cima do canvas              |
| Servidor     | reutiliza `src/shared`                               | novo `src/server/`, ou pacote próprio num monorepo          |

Contas, matchmaking, ranked, inventário e anti-cheat são serviços de
backend. Ficam fora deste cliente e dependem do servidor autoritativo.

## Decisões

- **64 Hz** de tick: bom equilíbrio entre precisão e custo para clientes web e
  servidores. Está num único sítio (`SimulationConfig`), por isso é fácil mudar.
- **Sem framework de UI, ECS ou física** por agora: seriam dependências antes de
  existir um problema concreto que as justifique.
- **Vitest** para testes (só devDependency): reutiliza a config do Vite
  (aliases, TypeScript) sem loaders próprios. Os testes correm em Node, sem DOM
  simulado. O dispositivo do browser é testado com `EventTarget` e fakes mínimos.
- **TypeScript estrito** (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`). `erasableSyntaxOnly` proíbe sintaxe que
  gera código (enums, namespaces), por isso os ficheiros continuam
  compatíveis com o type-stripping do Node, o que simplifica correr
  `src/shared` num servidor.
