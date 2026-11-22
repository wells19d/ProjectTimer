(() => {
  function confirmDelete(dialog, cancelButton) {
    if (dialog.open) return Promise.resolve(false);
    dialog.returnValue = 'cancel';
    return new Promise((resolve, reject) => {
      const closed = () => resolve(dialog.returnValue === 'delete');
      dialog.addEventListener('close', closed, { once: true });
      try {
        dialog.showModal();
        cancelButton.focus();
      } catch (error) {
        dialog.removeEventListener('close', closed);
        reject(error);
      }
    });
  }
  // Text is set by the renderer with textContent before opening the dialog.
  const api = { confirmDelete };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.Confirmation = api;
})();
