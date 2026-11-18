(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('shift') !== '1') return;
  const button = document.getElementById('installGame');
  const standalone = matchMedia('(display-mode: standalone)');
  let promptEvent;
  function showButton() { button.hidden = standalone.matches || navigator.standalone === true; }
  showButton();
  standalone.addEventListener('change', showButton);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    promptEvent = event;
    showButton();
  });
  window.addEventListener('appinstalled', () => { button.hidden = true; promptEvent = null; });
  button.addEventListener('click', async () => {
    if (promptEvent) {
      const event = promptEvent;
      promptEvent = null;
      await event.prompt();
    } else {
      alert(/iPad|iPhone|iPod/.test(navigator.userAgent)
        ? 'In Safari, open Share and choose Add to Home Screen. Enable Open as Web App if shown.'
        : 'Open your browser menu and choose Install app or Add to Home screen. In Chrome on a computer, look for the install icon in the address bar.');
    }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('warehouse-shift-sw.js', { scope: './floor-plan.html' })
    .catch((error) => console.warn('Offline installation unavailable', error));
})();
