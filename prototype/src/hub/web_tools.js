/**
 * Ferramentas de navegação web e pesquisa para os agentes
 */
export function registerWebTools(registry) {
  // 1. web_search
  registry.register({
    name: 'web_search',
    description: 'Pesquisa na web por um termo ou dúvida técnica e retorna os principais resultados com títulos, links e resumos.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termo de busca na internet' },
        maxResults: { type: 'number', description: 'Número máximo de resultados (padrão: 5)' }
      },
      required: ['query']
    },
    execute: async ({ query, maxResults = 5 }) => {
      try {
        // Usa API DuckDuckGo HTML / Instant Answer livre de chaves
        const encoded = encodeURIComponent(query);
        const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
        
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (!res.ok) {
          throw new Error(`Falha na busca HTTP: ${res.statusText}`);
        }

        const html = await res.text();
        const results = [];
        
        // Extrai snippets e links básicos de forma segura
        const regex = /<a class="result__snippet[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
        const titleRegex = /<a class="result__url[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
        
        let match;
        let count = 0;
        
        // Regex para blocos de resultados
        const resultBlockRegex = /<div class="result__body">([\s\S]*?)<\/div>/gi;
        while ((match = resultBlockRegex.exec(html)) !== null && count < maxResults) {
          const block = match[1];
          const urlMatch = /href="([^"]+)"/i.exec(block);
          const snippetMatch = /class="result__snippet[^>]*>([\s\S]*?)<\/a>/i.exec(block);
          
          if (urlMatch && snippetMatch) {
            let actualUrl = urlMatch[1];
            if (actualUrl.includes('uddg=')) {
              const parsed = new URL(actualUrl, 'https://duckduckgo.com');
              actualUrl = decodeURIComponent(parsed.searchParams.get('uddg') || actualUrl);
            }
            const snippet = snippetMatch[1].replace(/<[^>]+>/g, '').trim();
            results.push({
              url: actualUrl,
              snippet
            });
            count++;
          }
        }

        return {
          query,
          count: results.length,
          results: results.length > 0 ? results : [{ note: 'Nenhum resultado direto extraído, tente termos alternativos.' }]
        };
      } catch (err) {
        return {
          query,
          error: `Erro ao realizar busca web: ${err.message}`
        };
      }
    }
  });

  // 2. read_web_page
  registry.register({
    name: 'read_web_page',
    description: 'Acessa uma página web (URL) e extrai o texto principal para leitura e análise técnica.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL da página a ser lida' }
      },
      required: ['url']
    },
    execute: async ({ url }) => {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (!res.ok) {
          throw new Error(`Falha ao acessar ${url}: HTTP ${res.status}`);
        }

        const html = await res.text();
        
        // Limpeza básica de scripts, estilos e tags HTML
        let cleanText = html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
          .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();

        // Limita a 15.000 caracteres para não estourar contexto desnecessariamente
        const isTruncated = cleanText.length > 15000;
        cleanText = cleanText.slice(0, 15000);

        return {
          url,
          characterCount: cleanText.length,
          isTruncated,
          content: cleanText
        };
      } catch (err) {
        return {
          url,
          error: `Erro ao ler URL: ${err.message}`
        };
      }
    }
  });
}
