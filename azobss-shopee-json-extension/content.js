(function(){
  function clean(s){
    return String(s||'').replace(/\s+/g,' ').trim();
  }

  function getMeta(sel){
    const el=document.querySelector(sel);
    return clean(el && (el.content || el.getAttribute('content') || el.innerText));
  }

  function findJsonTitle(){
    const scripts=[...document.querySelectorAll('script')].map(s=>s.textContent||'');
    const patterns=[
      /"name"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i,
      /"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i,
      /"itemName"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i
    ];
    for(const txt of scripts){
      if(!/Shopee|product|item|name|title/i.test(txt)) continue;
      for(const re of patterns){
        const m=txt.match(re);
        if(m && m[1]){
          try{return JSON.parse('"'+m[1]+'"');}catch(e){return m[1];}
        }
      }
    }
    return '';
  }

  function extract(){
    const title = clean(
      getMeta('meta[property="og:title"]') ||
      getMeta('meta[name="title"]') ||
      clean(document.querySelector('h1')?.innerText) ||
      clean(document.querySelector('[data-testid="pdp-product-title"]')?.innerText) ||
      findJsonTitle() ||
      document.title.replace(/\|.*$/,'')
    );

    const description = clean(
      getMeta('meta[property="og:description"]') ||
      getMeta('meta[name="description"]')
    );

    const image = clean(
      getMeta('meta[property="og:image"]') ||
      getMeta('meta[name="twitter:image"]')
    );

    return {
      source:'azobss-shopee-extension',
      title,
      description,
      image,
      url:location.href,
      capturedAt:new Date().toISOString()
    };
  }

  function downloadJson(data){
    if(!data.title || /free shipping across malaysia|shopee malaysia/i.test(data.title)){
      console.warn('AZOBSS: product title not found or generic.', data);
    }
    const safe=(data.title||'shopee-product')
      .replace(/[\\/:*?"<>|]+/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,80) || 'shopee-product';
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=safe+'.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1200);
  }

  function run(){
    const data=extract();
    downloadJson(data);
  }

  // Delay so Shopee React page can render.
  setTimeout(run, 4500);
})();