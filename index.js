require('dotenv').config();
const Parser = require('rss-parser');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cron = require('node-cron');
const http = require('http');

// Supabase & Gemini İstemcileri
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const parser = new Parser({ 
  customFields: { item: ['media:content', 'enclosure'] },
  headers: { 'User-Agent': 'Mozilla/5.0' } 
});

const FEEDS = [
  'https://www.haber61.net/rss',
  'https://www.taka61.net/rss/trabzonspor',
  'https://www.61saat.com/rss'
];

const SPOR_KELIMELERI = ['trabzonspor', 'bordo', 'papara park', 'ertuğrul doğan', 'şenol güneş', 'thomas reis', 'akyazı', 'derbi', 'süper lig', 'transfer'];
const CHOP_KELIMELERI = ['dolmuş', 'fiyatları', 'belediye', 'muhtar', 'kaza', 'siyaset', 'parti', 'seçim', 'su birikintisi', 'vefat'];

// Gemini İle Telifsiz Özgün İçerik Üretme Fonksiyonu
async function rewriteWithGemini(originalTitle, originalSummary) {
  try {
    const prompt = `Sen 61Dalga adında bağımsız bir Trabzonspor haber sitesinin editörüsün.
Aşağıdaki haberi telif hakkı doğurmayacak şekilde tamamen kendi cümlelerinle özgünleştir. 
Yanıtını TAM OLARAK şu JSON formatında ver:
{
  "title": "Çarpıcı ve özgün Trabzonspor başlığı",
  "summary": "2-3 cümlelik heyecanlı, akıcı ve tamamen özgün haber özeti"
}

Haber Başlığı: ${originalTitle}
Haber Detayı: ${originalSummary}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // JSON Temizleme
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.error('[GEMINI HATA]:', err.message);
  }
  
  // Hata durumunda yedek temizleme
  return {
    title: originalTitle.replace(/^(İşte|Bakın|Şok|Son Dakika!|Flaş)\s*/i, '').trim(),
    summary: originalSummary.replace(/<[^>]*>/g, '').substring(0, 200).trim() + '...'
  };
}

async function scanNews() {
  console.log('[61DALGA BOT] Gemini Destekli RSS Taranıyor...');
  
  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const item of feed.items || []) {
        const title = item.title || '';
        const summary = item.contentSnippet || item.content || item.summary || '';
        const link = item.link;
        if (!link) continue;

        const text = (title + ' ' + summary).toLowerCase();
        if (CHOP_KELIMELERI.some(w => text.includes(w))) continue;
        if (!SPOR_KELIMELERI.some(w => text.includes(w))) continue;

        // Resim URL'sini Yakalama
        let imageUrl = '';
        if (item.enclosure && item.enclosure.url) imageUrl = item.enclosure.url;
        else if (item['media:content'] && item['media:content'].$.url) imageUrl = item['media:content'].$.url;

        const { data } = await supabase.from('articles').select('id').eq('link', link);
        if (!data || data.length === 0) {
          
          console.log('[GEMINI İŞLENİYOR]:', title);
          const aiData = await rewriteWithGemini(title, summary);

          await supabase.from('articles').insert([{
            link: link,
            original_title: title,
            original_summary: summary,
            rewritten_title: aiData.title,
            rewritten_summary: aiData.summary,
            image_url: imageUrl || 'https://via.placeholder.com/600x350?text=61Dalga+Trabzonspor',
            source: feed.title || 'Trabzon Basını',
            published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
          }]);

          console.log('[TELİFSİZ HABER EKLENDİ]:', aiData.title);
        }
      }
    } catch (err) {
      console.error('[RSS HATA]:', err.message);
    }
  }
}

cron.schedule('*/5 * * * *', scanNews); // 5 dakikada bir çalışır

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.end('61Dalga Gemini Bot Active'); }).listen(PORT, () => { scanNews(); });
