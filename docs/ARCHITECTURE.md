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
  ecrãs mais largos veem mais para os lados e nunca menos na vertical. O
  valor é o do CS2: 106,26° a 16:9 (90° a 4:3).
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
| `held` | ações seguras no momento da amostra (contínuo: walk, crouch, fogo automático) | bitmask |
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
| `PlayerState.ts` | estado completo e serializável (posição dos pés, velocidade, yaw/pitch, grounded, crouched, crouchAmount, walking, stamina, jump buffer); hull e altura dos olhos |
| `PlayerMovementConfig.ts` | todos os valores de tuning, com a cvar do CS de onde vêm |
| `look.ts` | yaw livre (com wrap) e pitch limitado |
| `horizontal.ts` | velocidade desejada (vetor limitado ao disco unitário), fricção e aceleração do Source no chão, aceleração no ar |
| `vertical.ts` | gravidade (cinemática exata) e jump buffer |
| `stamina.ts` | cansaço de saltos e aterragens (anti bunny-hop) |
| `crouch.ts` | agachar e levantar, com verificação de espaço |
| `kinematics.ts` | collide-and-slide por eixo, subir degraus e sonda de chão |
| `PlayerController.ts` | ordem das fases dentro de um tick |

### Valores (`DEFAULT_PLAYER_MOVEMENT`): modelo do CS2

O movimento reproduz o do Counter-Strike 2, a referência que o Standoff 2 e
o Critical Ops também seguem. Os valores são as cvars e as dimensões do CS2,
convertidos para metros (1 unidade Source = 1 polegada = 0,0254 m).

| Parâmetro | CS2 | Metros | Consequência a 64 Hz (medida nos testes) |
| --- | --- | --- | --- |
| hull | 32 × 72 u (agachado 54 u) | 0,81 × 1,83 m (1,37 m) | passa em aberturas de 0,85 m, não em 0,75 m; túnel de 1,5 m só agachado |
| olhos | 64 / 46 u (8 u abaixo do topo) | 1,626 / 1,168 m | agachar no ar não mexe a vista |
| velocidade máxima | 250 u/s (faca) | 6,35 m/s | as armas vão baixá-la (AK-47: 215 u/s) |
| walk (`Shift`) / crouch | × 0,52 / × 0,34 | 3,30 / 2,16 m/s | atingidas em 9 / 16 ticks |
| `sv_accelerate` | 5,5 | | 0 → 6,35 m/s em 35 ticks (0,55 s) |
| `sv_friction` / `sv_stopspeed` | 5,2 / 80 u/s | — / 2,03 m/s | largar as teclas: ≤ 34 % em 13 ticks, parado em 26 (0,41 s, 0,94 m) |
| counter-strafe | (fricção + aceleração) | | ≤ 34 % em 5 ticks (0,08 s), inverte ao 8.º (0,29 m) |
| `sv_airaccelerate` / `sv_air_max_wishspeed` | 12 / 30 u/s | — / 0,76 m/s | air strafing: +20 % num salto a rodar 160°/s |
| `sv_gravity` / altura do salto | 800 u/s² / 57 u | 20,32 m/s² / 1,448 m | impulso √(2gh) = 7,67 m/s; 49 ticks (0,77 s) no ar |
| `sv_stepsize` | 18 u | 0,457 m | 0,45 m sobe-se a andar, 0,6 m obriga a saltar |
| `sv_maxvelocity` | 3500 u/s | 88,9 m/s | limite por eixo, salvaguarda |
| jump buffer | 0 (como no CS) | | o press tem de acontecer no chão; configurável para mobile |
| stamina | aproximação nossa | | ver abaixo |
| pitch | ±89° | | |

Os testes verificam estas consequências a partir da configuração. Afinar
sempre em `PlayerMovementConfig.ts`, nunca no controller.

### Movimento horizontal

- A direção do input é limitada ao disco unitário: W+D é normalizado e não é
  mais rápido que W. Um stick analógico a meio pede metade da velocidade.
- Corre-se por defeito. `Shift` (walk) anda a 52 % e em silêncio (para o
  futuro sistema de som); agachado anda a 34 %. Walk não tem efeito agachado.
- **No chão (Source):** primeiro a fricção tira max(velocidade, stopspeed) ×
  5,2 × dt: proporcional a correr (abranda suave), constante perto de zero
  (para em tempo finito). Depois a aceleração soma, na direção desejada, até
  5,5 × 6,35 m/s × dt, mas só até a componente nessa direção chegar à
  velocidade desejada. A aceleração nunca tira velocidade.
- **Counter-strafe:** carregar na direção oposta soma a aceleração à fricção,
  por isso trava ~2,5× mais depressa do que largar as teclas. É o que dá o
  "parar para disparar" do CS.
- **Walk e crouch** aceleram com a base da velocidade máxima, não da
  velocidade da postura. Com a fórmula pura, a fricção quase anula a
  aceleração agachado e começar a andar demoraria ~1,6 s; no CS arranca-se
  tão depressa como a correr.
- **No ar (Source):** sem fricção; a aceleração (× 12) só leva a componente na
  direção desejada até 0,76 m/s. Segurar uma tecla quase não muda o momento,
  mas fazer strafe enquanto se roda a vista mantém a direção desejada quase
  perpendicular à velocidade e ganha velocidade (air strafing).
- **Contra uma parede**, o eixo bloqueado perde a velocidade e fica só a
  componente paralela (deslizar a 70–80 % da velocidade num ângulo de 45°).

### Stamina (anti bunny-hop)

O CS abranda o jogador depois de saltar e de aterrar, para que o bunny hop e
o spam de saltos não sejam gratuitos. A fórmula exata do CS2 não é pública,
por isso isto é uma aproximação nossa:
- saltar e aterrar (a cair a mais de 1 m/s) somam 0,2 de cansaço (0..1), que
  recupera a 0,6/s;
- com cansaço, a velocidade no chão fica limitada a 6,35 × (1 − 0,4 ×
  cansaço), e cada salto mantém só essa fração da velocidade horizontal;
- um salto isolado: aterra-se a 92 % da velocidade e recupera-se em 0,34 s;
- saltos encadeados: cada hop perde ~7,6 % (6,35 → 5,87 → 5,42 → 5,01 m/s…).

Spawns e degraus não contam como aterragens.

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
  0,457 m (18 u) e desce-se depois. Só é aceite se chegar mais longe. Paredes mais
  altas que um degrau continuam a bloquear, por isso não se trepam paredes.
- **Salvaguarda:** no início de cada tick, se o hull estiver dentro de
  geometria (spawn, teleporte, futura correção de rede), é empurrado para fora
  pelo eixo mais curto.
- Rapier não foi necessário. Faz sentido quando houver geometria não-AABB
  (rampas, malhas) ou corpos dinâmicos.

### Grounded

- Depois de mover, faz-se uma sonda de chão para baixo. Se estiver a subir,
  nunca está grounded.
- A andar (grounded no tick anterior e sem saltar), a sonda chega aos 0,457 m:
  descer degraus e lancis mantém o contacto com o chão. Uma queda maior
  deixa-o no ar.
- No ar, a sonda só chega a 1 cm. O jogador aterra exatamente na superfície
  (y do topo) e a velocidade vertical passa a 0.
- Parado no chão não há acumulação de gravidade nem deriva: a posição fica
  bit a bit igual.

### Crouch

- O hull muda de imediato; a altura dos olhos muda em 0,2 s. A velocidade
  máxima passa a 34 % (2,16 m/s).
- **No chão:** os pés ficam no sítio e o topo desce.
- **No ar (ou no tick do salto):** a cabeça fica no sítio e as pernas
  encolhem 18 u (0,457 m). É o crouch-jump, que chega a caixas de 64 u
  (1,63 m); o salto normal não chega. Como os olhos estão 8 u abaixo do topo
  nas duas posturas, a vista não se mexe.
- **Levantar** exige espaço livre para o hull de pé. No ar tenta-se primeiro
  estender as pernas para baixo e depois subir a cabeça. Sem espaço (túnel de
  1,5 m), o jogador fica agachado e levanta-se sozinho quando houver espaço.
  Levantar nunca empurra o jogador para dentro de um teto.

### Jump e gravidade

- Salta-se só se estava grounded no início do tick e houve um *press* (não
  basta ter a tecla segura). Não há duplo salto nem auto-jump.
- Como no CS, não há jump buffer: um press no ar perde-se. O buffer existe
  (`jumpBufferSeconds`) para quem o quiser, por exemplo em mobile.
- O tick do salto segue as regras do ar (sem fricção), como no Source. O
  cansaço corta a velocidade horizontal (ver Stamina).
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
- obstáculos de 0,2 / 0,45 (sobem-se a andar) / 0,6 / 1,2 (salto) / 1,63
  (64 u, crouch-jump) / 2,1 m (inacessível);
- escadas até uma plataforma de 1,5 m;
- corredor de 1,2 m;
- aberturas de 0,85 m (passa) e 0,75 m (não passa);
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
