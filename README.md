# xD — FPS competitivo para Web

Fundação técnica do cliente de um FPS competitivo para browser.
TypeScript + Vite + Three.js (WebGPU com fallback para WebGL 2).

Estado atual: bootstrap, renderer, game loop com simulação a tick fixo, arena
graybox com uma área de teste de movimento, iluminação, overlay de debug,
sistema de input (um comando de input por tick, independente do dispositivo),
player controller determinístico com câmara em primeira pessoa, e a base de
armas: uma AK-47 com os valores do CS2 (cadência, precisão, recuo, munição),
tiros hitscan, mira dinâmica e arma em primeira pessoa. Ainda não há alvos,
dano aplicado, rede, áudio nem menus, e isso é intencional (ver
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

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
| `?debug=weapon`   | Mostra o painel **temporário** da arma: munição, cadência, recuo, precisão, último impacto |
| `?viewmodel=0`    | Esconde a arma em primeira pessoa (como `r_drawviewmodel 0` no CS) |
| `?spawn=x,y,z,yaw`| Faz spawn nessa posição (yaw em graus), para testes reproduzíveis |

### Controlos (desktop)

Clicar na vista do jogo captura o rato (Pointer Lock). `Esc` liberta-o.
Enquanto não há captura, nenhum input chega ao jogo. O jogador aparece na
entrada da área de teste de movimento, a leste da arena.

O movimento segue o modelo do CS2 (valores em `PlayerMovementConfig.ts`):
corre por defeito à velocidade da arma (AK-47: 215 u/s = 5,46 m/s; faca:
250 u/s), `Shift` anda em silêncio a 52 % e agachado anda a 34 %. Fricção e aceleração do Source: largar as teclas
demora ~0,4 s a parar, carregar na direção oposta (counter-strafe) trava em
~0,1 s. No ar, virar a vista enquanto se faz strafe ganha velocidade (air
strafing). Saltar e aterrar cansa: velocidade reduzida durante um instante,
o que torna o bunny hop pouco eficaz.

| Entrada               | Ação                       |
| --------------------- | -------------------------- |
| `W` `A` `S` `D`       | mover (frente/esq./trás/dir.) |
| Rato                  | olhar                      |
| `Espaço`              | saltar                     |
| `Ctrl`                | agachar                    |
| `Shift`               | andar (silencioso)         |
| Botão esquerdo        | disparar (automático: segurar) |
| `R`                   | recarregar                 |
| Botão direito         | aim (sem efeito: a AK-47 não tem mira) |

Um salto normal sobe 57 u (1,45 m). Saltar e agachar no ar (ou premir os
dois ao mesmo tempo) é um crouch-jump: chega a caixas de 64 u (1,63 m), como
no CS.

A AK-47 dispara a 600 balas por minuto, 30 no carregador e 90 de reserva,
recarrega em 2,47 s (e sozinha ao disparar com o carregador vazio). Como no
CS: o primeiro tiro parado é preciso, a correr ou no ar os tiros vão para
todo o lado, abaixo de 34 % da velocidade (counter-strafe, agachado a andar)
volta a ser preciso, e o spray segue sempre o mesmo padrão de recuo (sobe e
depois vai para os lados), que se aprende a compensar puxando o rato. A mira
abre com a imprecisão real e acompanha o recuo (onde as balas vão).

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
    math/                   Vec3 simples (sem Three.js); seno, cosseno, exp e números aleatórios determinísticos
    simulation/SimulationConfig.ts  tick rate autoritativo (64 Hz)
    time/FixedTimestep.ts   acumulador de passo fixo (sem relógio próprio)
    maps/MapDefinition.ts   formato de dados de mapas (sólidos AABB) + bounds
    maps/grayboxArena.ts    arena graybox simétrica
    input/                  InputAction, InputCommand (contrato de rede), histórico por tick
    physics/                colisão AABB: sweeps por eixo, overlap, saída de penetração, raycast
    player/                 player controller determinístico (estado, config, movimento, colisão)
    weapons/                armas: dados (AK-47 do CS2), recuo, precisão, disparo, reload, hitscan
    character/              tick completo de um jogador: movimento + arma (o que a predição/servidor repetem)
  client/
    app/                    composition root (ClientApp), configuração, ecrã de erro fatal
    core/                   contrato GameSystem, scheduler de fases, game loop, logger
    input/                  InputSystem, InputState/InputPort, construção do comando por tick
      adapters/             dispositivo → input abstrato (teclado+rato; touch/gamepad no futuro)
      devices/              eventos do browser, Pointer Lock, focus/visibility
    player/                 simulação do jogador local por tick, câmara em primeira pessoa
    weapons/                apresentação da arma: recuo na câmara, arma em 1ª pessoa, marcas de bala
    ui/                     HUD em DOM: mira dinâmica, munição
    rendering/              renderer WebGPU/WebGL 2, viewport/resize, câmara, materiais TSL
    world/                  vista do mapa (malhas) e iluminação
    debug/                  estatísticas de frame, overlay de debug, painéis temporários (input, player, weapon)
    styles/                 CSS global
```

## Convenções

- Unidades em metros (valores do CS convertidos: 1 unidade Source = 0,0254 m). Sistema destro, Y para cima, −Z para a frente (convenção Three.js).
- FOV configurado como FOV horizontal a 16:9 (106,26°, o do CS2). O FOV vertical é constante ("Hor+").
- A simulação corre a 64 ticks/s, independente do refresh rate do ecrã.
- `src/shared` não importa `src/client`, Three.js nem APIs do browser.
- Imports entre camadas usam `@shared/...` e `@client/...`. Dentro da mesma camada usam caminhos relativos.
- Todo o recurso de GPU/DOM tem dono e é libertado com `dispose()`.
