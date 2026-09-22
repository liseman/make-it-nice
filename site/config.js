// make it nice — site configuration (plain script, loaded before the app)
//
// API_BASE: where the Cloudflare Worker lives. Leave '' to use the same origin as the page
//           (works when the Worker serves the site itself). If nothing answers, the site runs in
//           local-only mode: everything still works, but nothing is shared or learned across users.
// The GitHub Pages workflow overwrites API_BASE with the repository variable API_BASE when set.
window.MAKE_IT_NICE = {
  API_BASE: 'https://make-it-nice.lukeiseman.workers.dev',
  SITE_NAME: 'make it nice',
};
