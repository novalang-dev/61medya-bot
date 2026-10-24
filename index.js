require('dotenv').config();
const Parser = require('rss-parser');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
const http = require('http');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const parser = new Parser({ headers: { 'User-Agent': 'Mozilla/5.0' } });

// Trabzonspor RSS kaynakları
const FEEDS = [
  'https://www.haber61.net/rss',
  'https://www.taka61.net/rss/trabzonspor'
];

async function scanNews() {
  console.log('[61DALGA BOT] RSS Taranıyor...');
  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const item of feed.items || []) {
        const title = item.title || '';
        const summary = item.contentSnippet || item.content || '';
        const link = item.link;

        if (!link) continue;

        // Trabzonspor ve Bordo-Mavi filtre kontrolü
        const lowerTitle = title.toLowerCase();
        const lowerSummary = summary.toLowerCase();
        const isRelevant = lowerTitle.includes('trabzon') || lowerTitle.includes('bordo') || 
                           lowerSummary.includes('trabzon') || lowerSummary.includes('bordo');

        if (isRelevant) {
          // Mükerrer haber kontrolü
          const { data } = await supabase.from('articles').select('id').eq('link', link);
          
          if (!data || data.length === 0) {
            // Başlık ve özeti temizleme (Clickbait ve HTML temizleme)
            let cleanTitle = title.replace(/^(İşte|Bakın|Şok|Son Dakika!|Flaş)\s*/i, '').trim();
            let cleanSummary = summary.replace(/<[^>]*>/g, '').substring(0, 155).trim() + '...';

            await supabase.from('articles').insert([{
              link: link,
              original_title: title,
              original_summary: summary,
              rewritten_title: cleanTitle,
              rewritten_summary: cleanSummary,
              source: feed.title || 'Trabzon Basını',
              published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
            }]);

            console.log('[YENİ HABER EKLENDİ]:', cleanTitle);
          }
        }
      }
    } catch (err) {
      console.error('[RSS HATA]:', err.message);
    }
  }
}

// Her 5 dakikada bir çalıştır
cron.schedule('*/5 * * * *', scanNews);

// Render uyanık kalsın diye basit HTTP sunucusu
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('61Dalga Haber Botu Aktif!');
}).listen(PORT, () => {
  console.log(`[HTTP] Sunucu ${PORT} portunda çalışıyor.`);
  scanNews(); // İlk açılışta hemen bir defa tara
});