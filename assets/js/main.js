// modulabs Proposal Deck — main.js
// Mobile sidebar toggle + shared utilities

document.addEventListener('DOMContentLoaded', () => {
  // Mobile sidebar toggle
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') &&
          !sidebar.contains(e.target) &&
          !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  // Highlight active sidebar link
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.sidebar nav a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path || (path === '' && href === 'index.html')) {
      a.classList.add('active');
    }
    // Highlight packages parent for package detail pages
    if (path.startsWith('packages/') && href === 'index.html') {
      // do nothing — keep default
    }
  });
  // For package detail pages, mark catalog active
  if (path.startsWith('packages/')) {
    const cat = document.querySelector('.sidebar nav a[href="index.html#catalog"]');
    if (cat) cat.classList.add('active');
  }
});
