'use strict';

const portForm = document.querySelector('#port-form');
const portInput = document.querySelector('#server-port');
const portMessage = document.querySelector('#port-message');
const startupError = document.querySelector('#startup-error');
if (startupError) {
  const query = new URLSearchParams(location.search);
  startupError.textContent = query.get('error');
  portInput.value = query.get('port');
} else {
  portInput.value = location.port || '80';
}

async function applyPort(port) {
  const buttons = portForm.querySelectorAll('button');
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const result = await window.hostApi.changeServerPort(port);
    portMessage.textContent = result.ok ? '포트를 적용했습니다.' : result.message;
  } catch (error) {
    portMessage.textContent = error.message;
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

portForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void applyPort(portInput.valueAsNumber);
});
document.querySelector('#automatic-port').addEventListener('click', () => void applyPort(0));
