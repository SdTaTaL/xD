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
main.ts ──► client/app ──► client/{core, input, rendering, world, debug}
                 │                             │
                 └────────────► shared ◄───────┘
```

- `shared` → não depende de nada do projeto (nem de Three.js).
- `client/core` → só `shared`. Loop, scheduler e contrato de sistemas.
- `client/rendering` → Three.js + `client/core`.
- `client/world` → `rendering` + `shared/maps`. Converte dados do mapa em malhas.
- `client/input` → `client/core` + `shared/input`. Não conhece o renderer, e o
  renderer não conhece o input.
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
inteiro), `InputSystem`, `InputDebugPanel` (temporário, só com `?debug=input`),
`Viewport`, `GameRenderer`. Os sistemas de gameplay vão ser registados depois
do `InputSystem`, para que o comando do tick já exista quando o leem.

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

## Mapas

`MapDefinition` (shared) descreve a geometria estática como dados puros:
caixas alinhadas aos eixos, em metros. O mesmo formato vai alimentar a
renderização (hoje), a colisão e o servidor (no futuro). `MapView` (client)
é apenas uma vista: um único `BoxGeometry` unitário escalado por sólido e um
material por tipo de sólido.

## Onde entram os sistemas futuros

Exceto o Input, nada disto existe ainda. A tabela indica apenas onde cada
sistema deve viver quando for pedido.

| Sistema      | Lógica partilhada (`src/shared`)                     | Cliente (`src/client`)                                     |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------- |
| Input        | ✅ implementado: `shared/input/`                      | ✅ `input/`: teclado + rato. Falta touch e gamepad (ver [Input](#input)) |
| Player       | movimento determinístico (usado na predição e no servidor) | `player/`: câmara em 1ª pessoa, interpolação           |
| Weapons      | dados e regras de armas, hitscan                     | `weapons/`: viewmodels, efeitos                            |
| Gameplay     | regras de ronda/modo, estado de jogo                 | ligação do estado à apresentação                           |
| Physics      | colisão contra `MapDefinition` (Rapier só se for necessário) | depuração visual                                   |
| Networking   | protocolo, serialização, relógio de ticks            | `net/`: transporte, predição e reconciliação               |
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
