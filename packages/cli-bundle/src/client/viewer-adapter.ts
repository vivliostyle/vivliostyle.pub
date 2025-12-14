window.addEventListener('message', (event) => {
  if (event.data.type === 'print-pdf') {
    window.print();
  }
});
