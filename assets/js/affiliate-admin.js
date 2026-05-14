(function(){
  const STORAGE_KEY = 'azobss_affiliate_products_v4';
  const ADMIN_USERNAME = 'zedan91';

  function qs(s){return document.querySelector(s);}
  function qsa(s){return Array.from(document.querySelectorAll(s));}
  function clean(v){return String(v || '').trim().toLowerCase();}

  const AFFILIATE_DETECT_API = 'https://azobss-backend.onrender.com/api/detect-product';

  function categoryLabelToValue(label){
    const text = clean(label).replace(/&/g, 'and');
    const map = {
      'computer and accessories': 'computer',
      'cameras and drones': 'camera',
      'mobile and accessories': 'mobile',
      'health and beauty': 'health',
      'baby and toys': 'baby',
      'groceries and pets': 'groceries',
      'home and living': 'home-living',
      'home appliances': 'home-appliances',
      'sports and outdoor': 'sports',
      'gaming and consoles': 'gaming',
      'tickets and vouchers': 'tickets'
    };
    return map[text] || label || 'others';
  }

  function setAffiliateStatus(message, type){
    let el = qs('#affiliateDetectStatus');
    if(!el){
      el = document.createElement('div');
      el.id = 'affiliateDetectStatus';
      el.style.cssText = 'font-size:12px;font-weight:700;margin-top:7px;color:#22c55e;';
      qs('#affiliateDetectButton')?.parentElement?.after(el);
    }
    el.textContent = message || '';
    el.style.color = type === 'error' ? '#fb7185' : (type === 'warn' ? '#fbbf24' : '#22c55e');
  }

  async function autoDetectAffiliateProduct(){
    if(!adminDetected()) return;

    const linkInput = qs('#affiliateFullLinkInput') || qs('#affiliateLinkInput');
    const link = (linkInput?.value || qs('#affiliateLinkInput')?.value || '').trim();
    const btn = qs('#affiliateDetectButton');

    if(!link){
      setAffiliateStatus('Sila paste link produk Shopee dahulu.', 'error');
      return;
    }

    const oldText = btn ? btn.textContent : '';
    if(btn){
      btn.disabled = true;
      btn.textContent = '⏳ Detecting...';
    }
    setAffiliateStatus('Sedang baca link melalui backend Render...', 'warn');

    try{
      const res = await fetch(AFFILIATE_DETECT_API + '?url=' + encodeURIComponent(link));
      const text = await res.text();
      let data;
      try{
        data = JSON.parse(text);
      }catch(parseErr){
        throw new Error('Backend tidak pulangkan JSON. Pastikan Render sudah deploy versi terbaru.');
      }

      if(!res.ok || !data.ok){
        throw new Error(data.error || 'Auto detect gagal.');
      }

      qs('#affiliateTitleInput').value = data.title || '';
      qs('#affiliateDescInput').value = data.description || '';
      qs('#affiliateBadge').value = data.badge || 'Useful Item';
      qs('#affiliateIcon').value = data.icon || '🛒';
      qs('#affiliateMetaInput').value = data.meta || '';
      qs('#affiliateLinkInput').value = data.finalUrl || data.url || link;
      if(qs('#affiliateFullLinkInput')) qs('#affiliateFullLinkInput').value = data.finalUrl || data.url || link;

      const categoryValue = categoryLabelToValue(data.category || 'others');
      const cat = qs('#affiliateCategoryInput');
      if(cat && Array.from(cat.options).some(o => o.value === categoryValue)){
        cat.value = categoryValue;
      }else if(cat){
        cat.value = 'others';
      }

      setAffiliateStatus((data.note || 'Auto filled. Sila semak sebelum Save.') + ' Source: ' + (data.source || 'detect'), data.source === 'fallback' ? 'warn' : 'ok');
    }catch(err){
      setAffiliateStatus('Auto detect gagal: ' + err.message, 'error');
    }finally{
      if(btn){
        btn.disabled = false;
        btn.textContent = oldText || '🔍 Auto Detect';
      }
    }
  }

  function getCurrentUserObject(){
    const raw = sessionStorage.getItem('azobssCurrentUser');
    if(!raw) return null;
    try{
      return JSON.parse(raw);
    }catch(e){
      return null;
    }
  }

  function adminDetected(){
    // Must be signed in first
    if(sessionStorage.getItem('azobssLoggedIn') !== '1'){
      return false;
    }

    const currentUser = getCurrentUserObject();

    // Your existing login system uses usernameKey
    if(currentUser && clean(currentUser.usernameKey) === ADMIN_USERNAME){
      return true;
    }

    // Fallback if visible username is exactly zedan91
    const signedInName = clean(qs('#signedInName')?.textContent || qs('.user-name')?.textContent);
    if(signedInName === ADMIN_USERNAME){
      return true;
    }

    return false;
  }

  function refreshAdminState(){
    if(adminDetected()){
      document.body.classList.add('is-admin');
    }else{
      document.body.classList.remove('is-admin');
    }
  }

  function esc(text){
    return String(text || '').replace(/[&<>"']/g, c => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#039;'
    }[c]));
  }

  function getWrap(){return qs('.affiliate-products');}

  function ensureCardAdminButtons(){
    qsa('.affiliate-product-card').forEach((card, index) => {
      if(!card.dataset.affiliateId){
        card.dataset.affiliateId = 'aff-' + index + '-' + Date.now();
      }

      if(!card.querySelector('.affiliate-card-admin-actions')){
        const actions = document.createElement('div');
        actions.className = 'affiliate-card-admin-actions';
        actions.innerHTML = `
          <button class="edit" type="button" data-affiliate-edit="${esc(card.dataset.affiliateId)}">Edit</button>
          <button class="delete" type="button" data-affiliate-delete="${esc(card.dataset.affiliateId)}">Delete</button>
        `;
        card.prepend(actions);
      }
    });

    refreshAdminState();
  }

  function cardToProduct(card, index){
    const link = card.querySelector('a.btn, a[href]');
    return {
      id: card.dataset.affiliateId || ('aff-' + index + '-' + Date.now()),
      icon: (card.querySelector('.affiliate-product-icon')?.textContent || 'AZ').trim(),
      badge: (card.querySelector('.affiliate-badge')?.textContent || 'Affiliate').trim(),
      title: (card.querySelector('h3')?.textContent || 'Affiliate Product').trim(),
      desc: (card.querySelector('p')?.textContent || '').trim(),
      category: (card.dataset.category || '').trim(),
      meta: (card.querySelector('.affiliate-product-meta')?.textContent || '').trim(),
      link: link ? link.href : '#'
    };
  }

  function getProductsFromDOM(){
    ensureCardAdminButtons();
    return qsa('.affiliate-product-card').map(cardToProduct);
  }

  function saveProducts(products){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
  }

  function loadSavedProducts(){
    try{
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if(Array.isArray(saved) && saved.length){
        return saved;
      }
    }catch(e){}
    return null;
  }

  function productHTML(p){
    return `
      <article class="affiliate-product-card" data-affiliate-id="${esc(p.id)}" data-category="${esc(p.category || '')}">
        <div class="affiliate-card-admin-actions">
          <button class="edit" type="button" data-affiliate-edit="${esc(p.id)}">Edit</button>
          <button class="delete" type="button" data-affiliate-delete="${esc(p.id)}">Delete</button>
        </div>

        <div class="affiliate-product-top">
          <div class="affiliate-product-icon">${esc(p.icon || 'AZ')}</div>
          <span class="affiliate-badge">${esc(p.badge || 'Affiliate')}</span>
        </div>

        <h3>${esc(p.title)}</h3>
        <p>${esc(p.desc)}</p>
        <div class="affiliate-product-meta">${esc(p.meta || '')}</div>
        <a class="btn blue" href="${esc(p.link || '#')}" target="_blank" rel="noopener">View on Shopee</a>
      </article>
    `;
  }

  let products = [];

  function renderProducts(){
    const wrap = getWrap();
    if(!wrap) return;

    wrap.innerHTML = products.map(productHTML).join('');
    refreshAdminState();
    document.dispatchEvent(new CustomEvent('azobssAffiliateUpdated'));
  }

  function openModal(product){
    qs('#affiliateAdminTitle').textContent = product ? 'Edit Affiliate' : 'Add Affiliate';
    qs('#affiliateEditId').value = product ? product.id : '';
    qs('#affiliateIcon').value = product ? product.icon : '';
    qs('#affiliateBadge').value = product ? product.badge : '';
    qs('#affiliateTitleInput').value = product ? product.title : '';
    qs('#affiliateDescInput').value = product ? product.desc : '';
    qs('#affiliateCategoryInput').value = product ? product.category : 'computer';
    qs('#affiliateMetaInput').value = product ? product.meta : '';
    qs('#affiliateLinkInput').value = product ? product.link : '';
    if(qs('#affiliateFullLinkInput')) qs('#affiliateFullLinkInput').value = product ? product.link : '';
    setAffiliateStatus('', 'ok');
    qs('#affiliateAdminModal').classList.add('is-open');
  }

  function closeModal(){
    qs('#affiliateAdminModal')?.classList.remove('is-open');
  }

  function bindAdmin(){
    qs('#affiliateAddButton')?.addEventListener('click', () => {
      if(!adminDetected()) return;
      openModal(null);
    });

    qs('#affiliateAdminClose')?.addEventListener('click', closeModal);

    qs('#affiliateDetectButton')?.addEventListener('click', autoDetectAffiliateProduct);

    qs('#affiliateFullLinkInput')?.addEventListener('keydown', e => {
      if(e.key === 'Enter'){
        e.preventDefault();
        autoDetectAffiliateProduct();
      }
    });

    qs('#affiliateAdminModal')?.addEventListener('click', e => {
      if(e.target.id === 'affiliateAdminModal') closeModal();
    });

    qs('#affiliateAdminForm')?.addEventListener('submit', e => {
      e.preventDefault();
      if(!adminDetected()) return;

      const id = qs('#affiliateEditId').value || ('aff-' + Date.now());

      const item = {
        id,
        icon: qs('#affiliateIcon').value.trim() || 'AZ',
        badge: qs('#affiliateBadge').value.trim() || 'Affiliate',
        title: qs('#affiliateTitleInput').value.trim(),
        desc: qs('#affiliateDescInput').value.trim(),
        category: qs('#affiliateCategoryInput').value,
        meta: qs('#affiliateMetaInput').value.trim(),
        link: qs('#affiliateLinkInput').value.trim()
      };

      const idx = products.findIndex(p => p.id === id);
      if(idx >= 0){
        products[idx] = item;
      }else{
        products.unshift(item);
      }

      saveProducts(products);
      renderProducts();
      closeModal();
    });

    document.addEventListener('click', e => {
      if(!adminDetected()) return;

      const editId = e.target.getAttribute('data-affiliate-edit');
      const deleteId = e.target.getAttribute('data-affiliate-delete');

      if(editId){
        const item = products.find(p => p.id === editId);
        if(item) openModal(item);
      }

      if(deleteId){
        const item = products.find(p => p.id === deleteId);
        const title = item ? item.title : deleteId;

        if(confirm('Delete affiliate item: ' + title + '?')){
          products = products.filter(p => p.id !== deleteId);
          saveProducts(products);
          renderProducts();
        }
      }
    });

    qs('#affiliateExportButton')?.addEventListener('click', () => {
      if(!adminDetected()) return;

      const blob = new Blob([JSON.stringify(products, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'affiliate-products.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    qs('#affiliateImportButton')?.addEventListener('click', () => {
      if(!adminDetected()) return;
      qs('#affiliateImportFile')?.click();
    });

    qs('#affiliateImportFile')?.addEventListener('change', function(){
      if(!adminDetected()) return;

      const file = this.files[0];
      if(!file) return;

      const reader = new FileReader();

      reader.onload = () => {
        try{
          const imported = JSON.parse(reader.result);
          if(!Array.isArray(imported)) throw new Error('Invalid file');

          products = imported;
          saveProducts(products);
          renderProducts();
          alert('Affiliate backup imported.');
        }catch(err){
          alert('Invalid affiliate backup file.');
        }
      };

      reader.readAsText(file);
    });

    qs('#affiliateResetButton')?.addEventListener('click', () => {
      if(!adminDetected()) return;

      if(confirm('Reset affiliate local changes?')){
        localStorage.removeItem(STORAGE_KEY);
        products = getProductsFromDOM();
        saveProducts(products);
        renderProducts();
      }
    });

    // ── Deploy to GitHub button ──────────────────────────────────────────
    qs('#affiliateDeployButton')?.addEventListener('click', async () => {
      if(!adminDetected()) return;

      const btn = qs('#affiliateDeployButton');

      // 1. Check server aktif
      let serverOk = false;
      try{
        const health = await fetch('https://127.0.0.1:7821/health', {signal: AbortSignal.timeout(2500)});
        serverOk = health.ok;
      }catch(e){}

      if(!serverOk){
        alert(
          '\u274C Deploy Server tidak aktif!\n\n' +
          'Sila jalankan deploy-server.js dahulu:\n\n' +
          '  1. Buka Command Prompt\n' +
          '  2. cd ke folder website anda\n' +
          '  3. Taip: node deploy-server.js\n' +
          '  4. Cuba semula button ini'
        );
        return;
      }

      if(!confirm('Deploy ' + products.length + ' produk ke GitHub sekarang?\n\nIni akan:\n\u2022 Tulis affiliate-products.json\n\u2022 Tulis affiliate-backup.json\n\u2022 Git commit + push')) return;

      // 2. Deploy
      const origHTML = btn.innerHTML;
      btn.textContent = '\u23F3 Deploying...';
      btn.disabled = true;

      try{
        const res = await fetch('https://127.0.0.1:7821/deploy', {
          method : 'POST',
          headers: {'Content-Type':'application/json'},
          body   : JSON.stringify(products),
        });

        const data = await res.json();

        if(data.ok){
          btn.innerHTML = '\uD83D\uDE80 Deploy to GitHub <span style="position:absolute;top:-9px;right:-9px;background:#22c55e;color:#052e16;font-size:10px;font-weight:bold;padding:2px 7px;border-radius:999px;white-space:nowrap;">\u2713 Done</span>';
          alert('\u2705 ' + data.message);
        }else{
          alert('\u274C Deploy gagal:\n' + data.message);
          btn.innerHTML = origHTML;
        }

      }catch(err){
        alert('\u274C Ralat semasa deploy:\n' + err.message);
        btn.innerHTML = origHTML;
      }

      btn.disabled = false;
    });
    // ────────────────────────────────────────────────────────────────────
  }

  function init(){
    if(!getWrap()) return;

    const saved = loadSavedProducts();

    if(saved){
      products = saved;
      renderProducts();
    }else{
      ensureCardAdminButtons();
      products = getProductsFromDOM();
      saveProducts(products);
    }

    bindAdmin();
    refreshAdminState();

    setInterval(() => {
      refreshAdminState();
      ensureCardAdminButtons();
    }, 500);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }
})();
