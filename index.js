require('dotenv').config();
const Parser = require('rss-parser');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
const http = require('http');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const parser = new Parser({ headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });

const FEEDS = [
  'https://www.haber61.net/rss',
  'https://www.taka61.net/rss/trabzonspor',
  'https://www.61saat.com/rss'
];

// Yalnızca Trabzonspor ve Futbol/Spor Terimleri
const SPOR_KELIMELERI = [
  'trabzonspor', 'bordo mavi', 'bordo-mavi', 'papara park', 'ertuğrul doğan', 
  'şenol güneş', 'thomas reis', 'akyazı', 'derbi', 'süper lig', 'futbol', 
  'transfer', 'sakatlık', 'ilk 11', 'bonservis', 'u19'
];

// Kesinlikle Engellenecek Alakasız Konular (Karaliste)
const CHOP_KELIMELERI = [
  'dolmuş', 'fiyatları', 'ücretleri', 'belediye', 'muhtar', 'kaza', 'yangın', 
  'dereye uçtu', 'elektrik kesintisi', 'siyaset', 'parti', 'seçim', 'su birikintisi', 
  'su ihtiyacı', 'vefat etti', 'gölet', 'boks'
];

async function scanNews() {
  console.log('[61DALGA BOT] Trabzonspor Odaklı RSS Taranıyor...');
  let addedCount = 0;

  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      
      for (const item of feed.items || []) {
        const title = item.title || '';
        const summary = item.contentSnippet || item.content || item.summary || '';
        const link = item.link;

        if (!link) continue;

        const text = (title + ' ' + summary).toLowerCase();

        // 1. Karaliste Kontrolü (Dolmuş, kaza, siyaset varsa DİREKT ELE)
        const isChop = CHOP_KELIMELERI.some(word => text.includes(word));
        if (isChop) continue;

        // 2. Trabzonspor / Spor Kontrolü
        const isSports = SPOR_KELIMELERI.some(word => text.includes(word));

        if (isSports) {
          const { data } = await supabase.from('articles').select('id').eq('link', link);
          
          if (!data || data.length === 0) {
            let cleanTitle = title.replace(/^(İşte|Bakın|Şok|Son Dakika!|Flaş)\s*/i, '').trim();
            let cleanSummary = summary.replace(/<[^>]*>/g, '').substring(0, 160).trim() + '...';

            const { error: insertError } = await supabase.from('articles').insert([{
              link: link,
              original_title: title,
              original_summary: summary,
              rewritten_title: cleanTitle,
              rewritten_summary: cleanSummary,
              source: feed.title || 'Trabzon Basını',
              published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
            }]);

            if (!insertError) {
              console.log('[FUTBOL HABERİ EKLENDİ]:', cleanTitle);
              addedCount++;
            }
          }
        }
      }
    } catch (err) {
      console.error('[RSS HATA]:', url, err.message);
    }
  }
  console.log(`[TARAMA BİTTİ] ${addedCount} adet saf Trabzonspor haberi eklendi.`);
}

cron.schedule('*/3 * * * *', scanNews);

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('61Dalga Haber Botu Aktif!');
}).listen(PORT, () => {
  console.log(`[HTTP] Sunucu ${PORT} portunda çalışıyor.`);
  scanNews();
});
