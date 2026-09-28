import '@client/styles/main.css';
import { ClientApp } from '@client/app/ClientApp';
import { resolveClientConfig, withRendererBackend, type ClientConfig } from '@client/app/ClientConfig';
import { showFatalError } from '@client/app/fatalError';
import { createLogger } from '@client/core/Logger';
import type { RenderBackend } from '@client/rendering/GameRenderer';

const log = createLogger('bootstrap');

let app: ClientApp | null = null;
/**
 * Bumped whenever the running app is torn down or replaced. Callbacks from,
 * and late creations of, an older app compare against it and back off.
 */
let generation = 0;
let recoveredFromDeviceLoss = false;

function teardown(): void {
  generation++;
  app?.dispose();
  app = null;
}

function fail(error: unknown): void {
  log.error(error);
  teardown();
  showFatalError(error);
}

/**
 * Device-loss policy: the first time a WebGPU device is lost, the client is
 * rebuilt on WebGL 2 for the rest of the session. Any other loss is fatal.
 */
function handleRendererLost(config: ClientConfig, error: Error, backend: RenderBackend): void {
  if (backend === 'WebGPU' && !recoveredFromDeviceLoss) {
    recoveredFromDeviceLoss = true;
    log.warn('WebGPU device lost; restarting on WebGL 2.', error.message);
    teardown();
    start(withRendererBackend(config, 'webgl')).catch(fail);
    return;
  }

  fail(error);
}

async function start(config: ClientConfig): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app root element');

  const startGeneration = ++generation;
  const isCurrent = (): boolean => startGeneration === generation;

  const created = await ClientApp.create(root, config, {
    onFatalError: (error) => {
      if (isCurrent()) fail(error);
    },
    onRendererLost: (error, backend) => {
      if (isCurrent()) handleRendererLost(config, error, backend);
    },
  });

  if (!isCurrent()) {
    // Superseded (device lost or fatal error) while it was being created.
    created.dispose();
    return;
  }

  app = created;
  app.start();
  log.info(`Running on ${app.backend}`);
}

start(resolveClientConfig(window.location.search)).catch(fail);
