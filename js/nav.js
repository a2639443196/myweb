const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!prefersReducedMotion) {
  const cards = document.querySelectorAll('.nav-card');
  cards.forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const rotateX = ((rect.height / 2 - y) / rect.height) * 10;
      const rotateY = ((x - rect.width / 2) / rect.width) * 12;
      card.style.setProperty('--tiltX', `${rotateX.toFixed(2)}deg`);
      card.style.setProperty('--tiltY', `${rotateY.toFixed(2)}deg`);
    });

    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--tiltX', '0deg');
      card.style.setProperty('--tiltY', '0deg');
    });
  });

  const orb = document.querySelector('.gradient-orb');
  if (orb) {
    window.addEventListener('pointermove', (event) => {
      const { innerWidth, innerHeight } = window;
      const offsetX = (event.clientX / innerWidth - 0.5) * 100;
      const offsetY = (event.clientY / innerHeight - 0.5) * 100;
      orb.style.transform = `translate3d(${offsetX}%, ${offsetY}%, 0)`;
    });
  }
}
