/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   CryptoJournal â€” deployment config (public values only)
   The Supabase URL and publishable key are designed to be public:
   they only allow what the database's row-level security permits
   (each signed-in user can read and write only their own rows).
   Never put a secret / service-role key here.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const CJ_CONFIG = Object.freeze({
  supabaseUrl: 'https://rpvnfbxqmlgpyzxieyyf.supabase.co',
  supabaseKey: 'sb_publishable_nYFqtF9bYd-2kgcQqpwYlQ__lOOOUGd',
  // Public address of the hosted app (GitHub Pages) â€” shown in Settings â†’ Sync for the iPhone
  appUrl: 'https://williamthefrank.github.io/cryptojournal/',
  mediaBucket: 'cj-media',
});
