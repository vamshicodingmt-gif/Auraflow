/**
 * The AuraFlow mark: a gothic dagger cross. Geometry matches scripts/generate_icons.py
 * and assets/brand/logo-*.svg, so the in-app logo and the OS icons are identical.
 */
const BLADE_AND_GUARD =
  '<path d="M512 232L548 360L556 430L548 520L512 792L476 520L468 430L476 360Z"/>' +
  '<path d="M292 372L346 352H476H548H678L732 372L678 392H548H476H346Z"/>';
const HILT_GEM = '<path fill="#0a0a0a" d="M512 356L524 372L512 388L500 372Z"/>';

export function daggerMarkup(extraClass = ''): string {
  return `<svg class="dagger ${extraClass}" viewBox="0 0 1024 1024" aria-hidden="true"><g fill="currentColor">${BLADE_AND_GUARD}</g>${HILT_GEM}</svg>`;
}

export function discLogoMarkup(extraClass = ''): string {
  return `<svg class="disc-logo ${extraClass}" viewBox="0 0 1024 1024" aria-hidden="true"><circle cx="512" cy="512" r="412" fill="#0a0a0a" stroke="#8b0000" stroke-width="12"/><circle cx="512" cy="512" r="388" fill="none" stroke="#e50914" stroke-opacity="0.45" stroke-width="3"/><g fill="#e50914">${BLADE_AND_GUARD}</g>${HILT_GEM}</svg>`;
}
