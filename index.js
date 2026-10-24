require('dotenv').config();
const Parser = require('rss-parser');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cron = require('node-cron');
const http = require('http');

// Supabase & Gemini İstemcileri
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// JSON yanıt zorlaması ile Gemini model tanımı
const model = genAI.getGenerativeModel({ 
  model: 'gemini-1.5-flash',
  generationConfig: { responseMimeType: "application/json" }
});

// Tarayıcı gibi görünen gelişmiş Parser (403 engeli için)
const parser = new Parser({ 
  customFields: { item: ['media:content', 'enclosure', 'content:encoded'] },
  headers: { 
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
  } 
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
Haber Detayı: ${originalSummary || originalTitle}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);

  } catch (err) {
    console.error('[GEMINI HATA]:', err.message);
    return {
      title: originalTitle.replace(/^(İşte|Bakın|Şok|Son Dakika!|Flaş)\s*/i, '').trim(),
      summary: (originalSummary || originalTitle).replace(/<[^>]*>/g, '').substring(0, 200).trim() + '...'
    };
  }
}

async function scanNews() {
  console.log('[61DALGA BOT] Gemini Destekli RSS Taranıyor...');
  
  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const item of feed.items || []) {
        const title = item.title || '';
        const rawContent = item['content:encoded'] || item.content || item.summary || item.contentSnippet || '';
        const summary = rawContent.replace(/<[^>]*>/g, '').trim();
        const link = item.link;
        
        if (!link) continue;

        const text = (title + ' ' + summary).toLowerCase();
        if (CHOP_KELIMELERI.some(w => text.includes(w))) continue;
        if (!SPOR_KELIMELERI.some(w => text.includes(w))) continue;

        // Görsel URL'sini 3 farklı noktadan tarayarak yakalama
        let imageUrl = '';
        if (item.enclosure && item.enclosure.url) {
          imageUrl = item.enclosure.url;
        } else if (item['media:content'] && item['media:content'].$.url) {
          imageUrl = item['media:content'].$.url;
        } else {
          const imgMatch = rawContent.match(/<img[^>]+src=["']([^"']+)["']/i);
          if (imgMatch) imageUrl = imgMatch[1];
        }

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
      console.error('[RSS HATA]:', url, err.message);
    }
  }
}

cron.schedule('*/5 * * * *', scanNews);

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.end('61Dalga Gemini Bot Active'); }).listen(PORT, () => { scanNews(); });
