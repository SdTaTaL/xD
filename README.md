# xD — FPS competitivo para Web

Fundação técnica do cliente de um FPS competitivo para browser.
TypeScript + Vite + Three.js (WebGPU com fallback para WebGL 2).

Estado atual: bootstrap, renderer, game loop com simulação a tick fixo, arena
graybox com uma área de teste de movimento, iluminação, overlay de debug,
sistema de input (um comando de input por tick, independente do dispositivo),
e player controller determinístico com câmara em primeira pessoa. Ainda não há
armas, rede, áudio nem UI de jogo, e isso é intencional (ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## Requisitos

- Node.js ≥ 22.12 (ver `.nvmrc`)
- Browser com WebGPU. Sem WebGPU é usado WebGL 2 automaticamente.

## Comandos

```bash
npm install         # instalar dependências
npm run dev         # servidor de desenvolvimento em http://localhost:5173
npm run typecheck   # verificação de tipos (cliente, código partilhado, testes e configs)
npm test            # testes unitários (Vitest); npm run test:watch em modo watch
npm run build       # typecheck + build de produção em dist/
npm run preview     # servir o build de produção em http://localhost:4173
```

### Parâmetros de desenvolvimento (query string)

| Parâmetro         | Efeito                                                   |
| ----------------- | -------------------------------------------------------- |
| `?renderer=webgl` | Força o backend WebGL 2                                  |
| `?debug=0`        | Esconde o overlay de debug                               |
| `?debug=input`    | Mostra também o painel **temporário** de debug do input  |
| `?debug=player`   | Mostra o painel **temporário** do movimento (combinável: `?debug=input,player`) |
| `?spawn=x,y,z,yaw`| Faz spawn nessa posição (yaw em graus), para testes reproduzíveis |

### Controlos (desktop)

Clicar na vista do jogo captura o rato (Pointer Lock). `Esc` liberta-o.
Enquanto não há captura, nenhum input chega ao jogo. O jogador aparece na
entrada da área de teste de movimento, a leste da arena.

| Entrada               | Ação                       |
| --------------------- | -------------------------- |
| `W` `A` `S` `D`       | mover (frente/esq./trás/dir.) |
| Rato                  | olhar                      |
| `Espaço`              | saltar                     |
| `Ctrl`                | agachar                    |
| `Shift`               | sprint (só para a frente)  |
| `R`                   | reload (sem efeito ainda)  |
| Botão esquerdo        | fire (sem efeito ainda)    |
| Botão direito         | aim (sem efeito ainda)     |

Saltar e agachar no ar (ou premir os dois ao mesmo tempo) é um crouch-jump:
chega a plataformas de 1,2 m.

## Estrutura

```
index.html                  página host (só o elemento #app)
vite.config.ts              config Vite (aliases vindos do tsconfig, chunk do three)
tsconfig.base.json          opções de compilação comuns + aliases @shared/* e @client/*
tsconfig.app.json           cliente de browser (DOM)
tsconfig.shared.json        código partilhado: sem DOM, o compilador impede APIs de browser
tsconfig.node.json          ficheiros de configuração executados em Node
docs/ARCHITECTURE.md        arquitetura, regras de dependência e evolução prevista
src/
  main.ts                   entry point: arranque, política de perda de GPU, ecrã de erro
  shared/                   lógica independente de motor/DOM (reutilizável por um servidor)
    math/Vec3.ts            vetor simples (sem Three.js)
    simulation/SimulationConfig.ts  tick rate autoritativo (64 Hz)
    time/FixedTimestep.ts   acumulador de passo fixo (sem relógio próprio)
    maps/MapDefinition.ts   formato de dados de mapas (sólidos AABB) + bounds
    maps/grayboxArena.ts    arena graybox simétrica
    input/                  InputAction, InputCommand (contrato de rede), histórico por tick
    physics/                colisão AABB: sweeps por eixo, overlap, saída de penetração
    player/                 player controller determinístico (estado, config, movimento, colisão)
  client/
    app/                    composition root (ClientApp), configuração, ecrã de erro fatal
    core/                   contrato GameSystem, scheduler de fases, game loop, logger
    input/                  InputSystem, InputState/InputPort, construção do comando por tick
      adapters/             dispositivo → input abstrato (teclado+rato; touch/gamepad no futuro)
      devices/              eventos do browser, Pointer Lock, focus/visibility
    player/                 simulação do jogador local por tick, câmara em primeira pessoa
    rendering/              renderer WebGPU/WebGL 2, viewport/resize, câmara, materiais TSL
    world/                  vista do mapa (malhas) e iluminação
    debug/                  estatísticas de frame, overlay de debug, painéis temporários (input, player)
    styles/                 CSS global
```

## Convenções

- Unidades em metros. Sistema destro, Y para cima, −Z para a frente (convenção Three.js).
- FOV configurado como FOV horizontal a 16:9 (103°). O FOV vertical é constante ("Hor+").
- A simulação corre a 64 ticks/s, independente do refresh rate do ecrã.
- `src/shared` não importa `src/client`, Three.js nem APIs do browser.
- Imports entre camadas usam `@shared/...` e `@client/...`. Dentro da mesma camada usam caminhos relativos.
- Todo o recurso de GPU/DOM tem dono e é libertado com `dispose()`.
