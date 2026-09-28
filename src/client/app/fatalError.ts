const PANEL_ID = 'fatal-error';

/**
 * Replaces the game view with an error panel. Safe to call repeatedly; the
 * latest error wins. Text is inserted as text, never as HTML.
 */
export function showFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'fatal-error';
    panel.setAttribute('role', 'alert');

    const title = document.createElement('h1');
    title.textContent = 'The game could not continue';
    const details = document.createElement('p');
    const hint = document.createElement('p');
    hint.className = 'fatal-error__hint';
    hint.textContent = 'Reload the page to try again. Technical details are in the browser console.';

    panel.append(title, details, hint);
    document.body.append(panel);
  }

  const details = panel.querySelector('p');
  if (details) details.textContent = message;
}
