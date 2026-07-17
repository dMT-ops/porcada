/* ============================================
   PORQUIM - App JavaScript
   Gestão Financeira Pessoal
   Dados armazenados em localStorage
   ============================================ */



    // =========================================
    // DATA LAYER (SUPABASE)
    // =========================================
    const SUPABASE_URL = 'https://mofjrvbbonxyfzwyfujm.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vZmpydmJib254eWZ6d3lmdWptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MDEzNDYsImV4cCI6MjA5Nzk3NzM0Nn0.i36MBJd18B4XQ00fzudsrCCYqfyetiW-0nVkEL9EuZU';
    const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // State
    let currentUser = null;
    let currentToken = null;
    let transacoes = [];
    let investimentos = [];
    let poupancas = [];
    let recorrentes = [];
    let metas = [];
    let isPrivacyMode = false;
    let selicRate = 10.5; // default fallback
    
    let userSettings = {
        nome: '',
        saldoInicial: 0,
        diaFechamento: 1,
        metaEconomia: 0,
        alertDays: 5,
        dateFormat: 'DD/MM/YYYY',
        hideInvestimentos: false,
        hidePoupanca: false,
        hideRadar: false,
        customCategoriesReceita: [],
        customCategoriesDespesa: [],
        accentColor: '#40C4FF',
        enableShortcuts: true
    };
    
    function applyAccentColor(hex) {
        if(!hex) return;
        document.documentElement.style.setProperty('--accent', hex);
        // Calcula RGB para usar no rgba() do CSS glow/hover
        let r = 0, g = 0, b = 0;
        if (hex.length === 7) {
            r = parseInt(hex.substring(1, 3), 16);
            g = parseInt(hex.substring(3, 5), 16);
            b = parseInt(hex.substring(5, 7), 16);
        }
        document.documentElement.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    }
    function loadSettings() {
        try {
            const saved = localStorage.getItem('porcada_settings');
            if (saved) {
                userSettings = { ...userSettings, ...JSON.parse(saved) };
            }
        } catch(e) { console.error('Erro ao carregar settings', e); }
        
        const d = new Date();
        const df = parseInt(userSettings.diaFechamento) || 1;
        if (df > 1 && d.getDate() >= df) {
            currentFilterMonth = d.getMonth() + 1;
            if (currentFilterMonth > 11) {
                currentFilterMonth = 0;
                currentFilterYear = d.getFullYear() + 1;
            }
        }
        
        applyAccentColor(userSettings.accentColor || '#40C4FF');
    }
    
    function saveSettings() {
        localStorage.setItem('porcada_settings', JSON.stringify(userSettings));
    }
    
    const AI_PROXY_URL = SUPABASE_URL + '/functions/v1/ai-proxy';
    
    async function fetchWithTimeoutAndRetry(url, options = {}, retries = 3, timeoutMs = 15000) {
        for (let i = 0; i <= retries; i++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                
                const res = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(timeoutId);
                
                if (res.status === 429 && i < retries) {
                    const cloned = await res.clone();
                    try {
                        const errBody = await cloned.json();
                        // Se for Rate Limit diário da Edge Function, não adianta tentar de novo
                        if (errBody.error && errBody.error.includes("requests per day")) return res; 
                    } catch(e) {}
                    
                    const waitMs = Math.pow(2, i) * 1000 + (Math.random() * 500);
                    await sleep(waitMs);
                    continue;
                }
                return res; 
            } catch (error) {
                if (i === retries) throw error; 
                if (error.name !== 'AbortError' && !error.message.includes('fetch')) {
                    throw error; 
                }
                const waitMs = Math.pow(2, i) * 1000 + (Math.random() * 500);
                await sleep(waitMs);
            }
        }
    }

    async function fetchWithCache(cacheKey, ttlMs, fetcherFn) {
        try {
            const cached = localStorage.getItem('cache_' + cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Date.now() - parsed.timestamp < ttlMs) {
                    return parsed.data;
                }
            }
        } catch (e) { console.warn("Cache read error", e); }
        
        const data = await fetcherFn();
        
        try {
            localStorage.setItem('cache_' + cacheKey, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (e) { console.warn("Cache write error", e); }
        
        return data;
    }

    async function fetchProxy(action, payload = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (currentToken) {
            headers['Authorization'] = `Bearer ${currentToken}`;
        }
        return fetchWithTimeoutAndRetry(AI_PROXY_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify({ action, payload })
        }, 3, 20000); // 20s timeout for AI/Brapi
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const today = new Date();
    let currentFilterMonth = today.getMonth(); // 0-11
    let currentFilterYear = today.getFullYear();
    
    let globalUsd = 0;
    let globalEur = 0;
    let globalBtc = 0;

    function animateCurrency(el, endVal, duration = 1000) {
        if (!el) return;
        const raw = el.textContent.replace(/[^\d,-]/g, '').replace(',', '.');
        const startVal = parseFloat(raw) || 0;
        
        if (isPrivacyMode || startVal === endVal) {
            el.textContent = isPrivacyMode ? 'R$ •••••' : formatCurrency(endVal);
            return;
        }

        const startTime = performance.now();
        const step = (currentTime) => {
            const progress = Math.min((currentTime - startTime) / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 4); // easeOutQuart
            const current = startVal + (endVal - startVal) * ease;
            
            if (isPrivacyMode) {
                el.textContent = 'R$ •••••';
                return;
            }
            
            el.textContent = formatCurrency(current);
            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                el.textContent = formatCurrency(endVal);
            }
        };
        requestAnimationFrame(step);
    }

    async function loadData() {
        loadSettings(); // Carrega configs do localStorage primeiro
        if (typeof populateCategorySelects === 'function') populateCategorySelects();
        if (typeof updateGreeting === 'function') updateGreeting();
        
        try {
            const [t, i, p, r, m] = await Promise.all([
                sbClient.from('transacoes').select('*'),
                sbClient.from('investimentos').select('*'),
                sbClient.from('poupancas').select('*'),
                sbClient.from('recorrentes').select('*'),
                sbClient.from('metas').select('*')
            ]);
            
            if (t.error) {
                console.error("Supabase Error:", t.error);
                showToast("Erro ao conectar ao banco de dados: " + t.error.message, "error");
            }
            
            transacoes = t.data || [];
            investimentos = i.data || [];
            poupancas = p.data || [];
            recorrentes = r.data || [];
            metas = m.data || [];
        } catch (error) {
            console.error("Fetch falhou:", error);
            showToast("Falha grave de conexão com o banco de dados.", "error");
        }
    }

    async function upsertData(table, item) {
        if (!item.id) item.id = generateId(); // Use generateId instead of crypto.randomUUID to match handleTransacaoSubmit
        if (!item.criado_em) item.criado_em = new Date().toISOString();
        if (currentUser) item.user_id = currentUser.id;
        const { error } = await sbClient.from(table).upsert(item);
        if (error) {
            console.error('Error upserting:', error);
            throw new Error(error.message);
        }
        return item;
    }

    async function deleteData(table, id) {
        const { error } = await sbClient.from(table).delete().eq('id', id);
        if (error) console.error(`Error deleting from ${table}:`, error);
    }


    function currentMonthStr() {
        return `${currentFilterYear}-${String(currentFilterMonth + 1).padStart(2, '0')}`;
    }

    // SVG icon helper - generates simple monochrome line icons
    function svgIcon(path, size) {
        size = size || 16;
        return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    }

    const SVG_PATHS = {
        briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
        laptop: '<rect x="2" y="4" width="20" height="12" rx="2"/><path d="M2 16h20"/><path d="M6 20h12"/>',
        trendUp: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
        gift: '<rect x="3" y="8" width="18" height="14" rx="1"/><path d="M12 8v14"/><path d="M3 12h18"/><path d="M12 8C9 8 7 6 7 4s2-3 3-3 2 2 2 2 1-2 2-2 3 1 3 3-2 4-5 4"/>',
        dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
        utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
        home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
        car: '<path d="M5 17h14M5 17a2 2 0 0 1-2-2V9l2-5h14l2 5v6a2 2 0 0 1-2 2M5 17a2 2 0 0 0-2 2v1h2m14-3a2 2 0 0 1 2 2v1h-2"/><circle cx="7.5" cy="17" r="0.5"/><circle cx="16.5" cy="17" r="0.5"/>',
        heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
        graduation: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/>',
        gamepad: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4m-2-2v4"/><circle cx="16" cy="10" r="0.5"/><circle cx="18" cy="12" r="0.5"/>',
        shirt: '<path d="M20.38 3.46L16 2 12 6 8 2 3.62 3.46a2 2 0 0 0-1.34 1.93v0L3 14l5-1v9h8v-9l5 1 .72-8.61a2 2 0 0 0-1.34-1.93z"/>',
        file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
        phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
        box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
        edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
        trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
        arrowUp: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
        arrowDown: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
    };

    const CATEGORY_ICONS = {
        'Salário': svgIcon(SVG_PATHS.briefcase), 'Freelance': svgIcon(SVG_PATHS.laptop), 'Investimentos': svgIcon(SVG_PATHS.trendUp), 'Presente': svgIcon(SVG_PATHS.gift),
        'Outros (Receita)': svgIcon(SVG_PATHS.dollar),
        'Alimentação': svgIcon(SVG_PATHS.utensils), 'Moradia': svgIcon(SVG_PATHS.home), 'Transporte': svgIcon(SVG_PATHS.car), 'Saúde': svgIcon(SVG_PATHS.heart),
        'Educação': svgIcon(SVG_PATHS.graduation), 'Lazer': svgIcon(SVG_PATHS.gamepad), 'Vestuário': svgIcon(SVG_PATHS.shirt), 'Contas': svgIcon(SVG_PATHS.file),
        'Assinaturas': svgIcon(SVG_PATHS.phone), 'Outros (Despesa)': svgIcon(SVG_PATHS.box),
    };

    const ICON_EDIT = svgIcon(SVG_PATHS.edit, 14);
    const ICON_TRASH = svgIcon(SVG_PATHS.trash, 14);
    const ICON_ARROW_UP = svgIcon(SVG_PATHS.arrowUp, 14);
    const ICON_ARROW_DOWN = svgIcon(SVG_PATHS.arrowDown, 14);

    const DEFAULT_CATEGORIAS_RECEITA = [
        'Salário', 'Freelance', 'Investimentos', 'Presente', 'Outros (Receita)'
    ];
    
    const DEFAULT_CATEGORIAS_DESPESA = [
        'Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 
        'Lazer', 'Vestuário', 'Contas', 'Assinaturas', 'Outros (Despesa)'
    ];

    function populateCategorySelects() {
        const transSelect = $('#transacaoCategoria');
        const recSelect = $('#recorrenteCategoria');
        const metaSelect = $('#metaCategoria');
        const filterSelect = $('#filterCategoria');
        
        const customRec = userSettings.customCategoriesReceita || [];
        const customDesp = userSettings.customCategoriesDespesa || [];
        
        const allReceitas = [...DEFAULT_CATEGORIAS_RECEITA, ...customRec];
        const allDespesas = [...DEFAULT_CATEGORIAS_DESPESA, ...customDesp];
        
        const buildOptions = (label, items) => {
            return `<optgroup label="${label}">` + 
                items.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('') +
            `</optgroup>`;
        };
        
        const html = buildOptions('Receitas', allReceitas) + buildOptions('Despesas', allDespesas);
        
        if (transSelect) transSelect.innerHTML = html;
        if (recSelect) recSelect.innerHTML = html;
        if (metaSelect) metaSelect.innerHTML = buildOptions('Despesas', allDespesas);
        if (filterSelect) filterSelect.innerHTML = `<option value="todos">Todas categorias</option>` + html;
    }

    // Poupança icon map (simple geometric shapes)
    const SAVINGS_ICONS = {
        'meta': '○', 'casa': '□', 'carro': '◇', 'viagem': '△',
        'educacao': '◎', 'emergencia': '⬡', 'especial': '☆', 'geral': '●',
        // Legacy emoji fallback
        '🎯': '○', '🏠': '□', '🚗': '◇', '✈️': '△',
        '🎓': '◎', '🛡️': '⬡', '💍': '☆', '🐷': '●',
    };

    // =========================================
    // DOM REFS
    // =========================================
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // =========================================
    // NAVIGATION
    // =========================================
    function initNav() {
        $$('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                switchView(view);
            });
        });

        $$('.btn-link[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                switchView(btn.dataset.view);
            });
        });

        // Mobile menu
        $('#menuToggle').addEventListener('click', () => {
            $('#sidebar').classList.toggle('open');
        });

        // Close sidebar on view change (mobile)
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 && !e.target.closest('.sidebar') && !e.target.closest('#menuToggle')) {
                $('#sidebar').classList.remove('open');
            }
        });
    }

    function switchView(viewName) {
        $$('.view').forEach(v => v.classList.remove('active'));
        $$('.nav-btn').forEach(b => b.classList.remove('active'));

        const view = $(`#view-${viewName}`);
        const btn = $(`.nav-btn[data-view="${viewName}"]`);
        if (view) view.classList.add('active');
        if (btn) btn.classList.add('active');

        // Refresh view data
        if (viewName === 'dashboard') refreshDashboard();
        if (viewName === 'transacoes') refreshTransacoes();
        if (viewName === 'recorrentes') refreshRecorrentes();
        if (viewName === 'investimentos') refreshInvestimentos();
        if (viewName === 'poupanca') refreshPoupanca();
        if (viewName === 'metas') refreshMetas();
        if (viewName === 'radar') refreshRadar();
        if (viewName === 'relatorios') refreshRelatorios();
        if (viewName === 'settings' && typeof populateSettingsForm === 'function') populateSettingsForm();
    }

    // =========================================
    // GREETING & DATE
    // =========================================
    function updateGreeting() {
        const h = new Date().getHours();
        let greeting = 'Boa noite';
        if (h >= 5 && h < 12) greeting = 'Bom dia';
        else if (h >= 12 && h < 18) greeting = 'Boa tarde';
        
        if (userSettings.nome) {
            greeting += `, ${userSettings.nome}`;
        }
        $('#greeting').textContent = greeting;
    }

    function updateMonthLabel() {
        const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        $('#currentMonthLabel').textContent = `${months[currentFilterMonth]} ${currentFilterYear}`;
    }

    function getMonthYear(dateStr) {
        const parts = dateStr.split('-');
        if (parts.length >= 3) {
            let y = parseInt(parts[0]);
            let m = parseInt(parts[1]);
            let d = parseInt(parts[2].substring(0, 2));
            if (userSettings.diaFechamento > 1 && d >= userSettings.diaFechamento) {
                m += 1;
                if (m > 12) { m = 1; y += 1; }
            }
            return `${y}-${String(m).padStart(2, '0')}`;
        }
        return dateStr.substring(0, 7);
    }

    function initMonthSelector() {
        updateMonthLabel();
        $('#prevMonth').addEventListener('click', () => {
            currentFilterMonth--;
            if (currentFilterMonth < 0) {
                currentFilterMonth = 11;
                currentFilterYear--;
            }
            updateMonthLabel();
            refreshAll();
        });
        $('#nextMonth').addEventListener('click', () => {
            currentFilterMonth++;
            if (currentFilterMonth > 11) {
                currentFilterMonth = 0;
                currentFilterYear++;
            }
            updateMonthLabel();
            refreshAll();
        });
    }

    async function updateTicker() {
        const tickerEl = $('#marketTicker');
        if (!tickerEl) return;
        try {
            const data = await fetchWithCache('cambio', 60 * 60 * 1000, async () => {
                const res = await fetchWithTimeoutAndRetry('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL,BTC-BRL', {}, 2, 5000);
                if (!res.ok) throw new Error('Falha ao carregar câmbio');
                return await res.json();
            });
            const usd = parseFloat(data.USDBRL.ask).toFixed(2);
            const eur = parseFloat(data.EURBRL.ask).toFixed(2);
            const btc = parseFloat(data.BTCBRL.ask).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
            
            globalUsd = usd;
            globalEur = eur;
            globalBtc = btc;
            
            tickerEl.innerHTML = `
                <div class="ticker-badge">
                    <span class="ticker-label">USD:</span>
                    <span class="ticker-val">R$ ${usd}</span>
                </div>
                <div class="ticker-badge">
                    <span class="ticker-label">EUR:</span>
                    <span class="ticker-val">R$ ${eur}</span>
                </div>
                <div class="ticker-badge">
                    <span class="ticker-label">BTC:</span>
                    <span class="ticker-val">R$ ${btc}</span>
                </div>
            `;
        } catch (e) {
            tickerEl.innerHTML = 'Mercado offline';
        }
    }

    async function fetchSelic() {
        try {
            const data = await fetchWithCache('selic', 60 * 60 * 1000, async () => {
                const res = await fetchWithTimeoutAndRetry('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json', {}, 2, 5000);
                if (!res.ok) throw new Error('Falha ao carregar Selic');
                return await res.json();
            });
            if (data && data[0] && data[0].valor) {
                selicRate = parseFloat(data[0].valor);
            }
        } catch (e) {
            console.error('Erro ao buscar Selic:', e);
        }
    }

    // =========================================
    // MODALS
    // =========================================
    function openModal(id) {
        $(`#${id}`).classList.add('show');
    }

    function closeModal(id) {
        $(`#${id}`).classList.remove('show');
    }

    function initModals() {
        // Transaction modal
        $('#btnNovaTransacao').addEventListener('click', () => openTransacaoModal());
        $('#btnNovaTransacao2').addEventListener('click', () => openTransacaoModal());
        $('#closeModalTransacao').addEventListener('click', () => closeModal('modalTransacao'));
        $('#cancelTransacao').addEventListener('click', () => closeModal('modalTransacao'));

        // Investment modal
        $('#btnNovoInvestimento').addEventListener('click', () => openInvestimentoModal());
        $('#closeModalInvestimento').addEventListener('click', () => closeModal('modalInvestimento'));
        $('#cancelInvestimento').addEventListener('click', () => closeModal('modalInvestimento'));

        // Poupança modal
        $('#btnNovaPoupanca').addEventListener('click', () => openPoupancaModal());
        $('#closeModalPoupanca').addEventListener('click', () => closeModal('modalPoupanca'));
        $('#cancelPoupanca').addEventListener('click', () => closeModal('modalPoupanca'));

        // Add to poupança modal
        $('#closeModalAddPoupanca').addEventListener('click', () => closeModal('modalAddPoupanca'));
        $('#cancelAddPoupanca').addEventListener('click', () => closeModal('modalAddPoupanca'));

        // Recorrentes modal
        const btnNovoRecorrente = $('#btnNovoRecorrente');
        if (btnNovoRecorrente) btnNovoRecorrente.addEventListener('click', () => openRecorrenteModal());
        const closeModalRecorrente = $('#closeModalRecorrente');
        if (closeModalRecorrente) closeModalRecorrente.addEventListener('click', () => closeModal('modalRecorrente'));
        const cancelRecorrente = $('#cancelRecorrente');
        if (cancelRecorrente) cancelRecorrente.addEventListener('click', () => closeModal('modalRecorrente'));

        // Metas modal
        const btnNovaMeta = $('#btnNovaMeta');
        if (btnNovaMeta) btnNovaMeta.addEventListener('click', () => openMetaModal());
        const closeModalMeta = $('#closeModalMeta');
        if (closeModalMeta) closeModalMeta.addEventListener('click', () => closeModal('modalMeta'));
        const cancelMeta = $('#cancelMeta');
        if (cancelMeta) cancelMeta.addEventListener('click', () => closeModal('modalMeta'));

        // Confirm modal
        $('#closeModalConfirm').addEventListener('click', () => closeModal('modalConfirm'));
        $('#cancelConfirm').addEventListener('click', () => closeModal('modalConfirm'));

        // Close on overlay click
        $$('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove('show');
                }
            });
        });

        // Form submits
        $('#formTransacao').addEventListener('submit', handleTransacaoSubmit);
        $('#formInvestimento').addEventListener('submit', handleInvestimentoSubmit);
        $('#formPoupanca').addEventListener('submit', handlePoupancaSubmit);
        $('#formAddPoupanca').addEventListener('submit', handleAddPoupancaSubmit);
        const formRecorrente = $('#formRecorrente');
        if (formRecorrente) formRecorrente.addEventListener('submit', handleRecorrenteSubmit);
    }

    // =========================================
    // TRANSAÇÕES CRUD
    // =========================================
    function openTransacaoModal(id) {
        const form = $('#formTransacao');
        form.reset();
        $('#transacaoId').value = '';
        $('#transacaoData').value = todayStr();
        $('#modalTransacaoTitle').textContent = 'Nova Transação';

        if (id) {
            const t = transacoes.find(x => x.id === id);
            if (t) {
                $('#modalTransacaoTitle').textContent = 'Editar Transação';
                $('#transacaoId').value = t.id;
                $('#transacaoTipo').value = t.tipo;
                $('#transacaoValor').value = t.valor;
                $('#transacaoDescricao').value = t.descricao;
                $('#transacaoCategoria').value = t.categoria;
                $('#transacaoData').value = t.data;
                $('#transacaoNota').value = t.nota || '';
            }
        }

        openModal('modalTransacao');
    }

    async function handleTransacaoSubmit(e) {
        e.preventDefault();
        const id = $('#transacaoId').value;
        const item = {
            id: id || generateId(),
            tipo: $('#transacaoTipo').value,
            valor: parseFloat($('#transacaoValor').value),
            descricao: $('#transacaoDescricao').value.trim(),
            categoria: $('#transacaoCategoria').value,
            data: $('#transacaoData').value,
            nota: $('#transacaoNota').value.trim(),
            criado_em: new Date().toISOString(),
        };

        if (id) {
            const idx = transacoes.findIndex(x => x.id === id);
            if (idx !== -1) {
                item.criado_em = transacoes[idx].criado_em;
            }
        }

        await upsertData('transacoes', item);
        await loadData();
        closeModal('modalTransacao');
        refreshAll();
    }

    function deleteTransacao(id) {
        showConfirm('Tem certeza que deseja excluir esta transação?', async () => {
            await deleteData('transacoes', id);
            await loadData();
            refreshAll();
        });
    }

    // =========================================
    // INVESTIMENTOS CRUD
    // =========================================
    function openInvestimentoModal(id) {
        const form = $('#formInvestimento');
        form.reset();
        $('#investimentoId').value = '';
        $('#investimentoData').value = todayStr();
        $('#modalInvestimentoTitle').textContent = 'Novo Investimento';

        if (id) {
            const inv = investimentos.find(x => x.id === id);
            if (inv) {
                $('#modalInvestimentoTitle').textContent = 'Editar Investimento';
                $('#investimentoId').value = inv.id;
                $('#investimentoNome').value = inv.nome;
                $('#investimentoTicker').value = inv.ticker || '';
                $('#investimentoTipo').value = inv.tipo;
                $('#investimentoValor').value = inv.valor;
                $('#investimentoData').value = inv.data;
                $('#investimentoRendimento').value = inv.rendimento || '';
                $('#investimentoNota').value = inv.nota || '';
            }
        }

        openModal('modalInvestimento');
    }

    async function handleInvestimentoSubmit(e) {
        e.preventDefault();
        const id = $('#investimentoId').value;
        const item = {
            id: id || generateId(),
            nome: $('#investimentoNome').value.trim(),
            ticker: $('#investimentoTicker').value.trim().toUpperCase(),
            tipo: $('#investimentoTipo').value,
            valor: parseFloat($('#investimentoValor').value),
            data: $('#investimentoData').value,
            rendimento: parseFloat($('#investimentoRendimento').value) || 0,
            nota: $('#investimentoNota').value.trim(),
            status: 'ativo',
            criado_em: new Date().toISOString(),
        };

        if (id) {
            const idx = investimentos.findIndex(x => x.id === id);
            if (idx !== -1) {
                item.criado_em = investimentos[idx].criado_em;
                item.status = investimentos[idx].status;
            }
        }

        await upsertData('investimentos', item);
        await loadData();
        closeModal('modalInvestimento');
        refreshAll();
    }

    async function toggleInvestimentoStatus(id) {
        const inv = investimentos.find(x => x.id === id);
        if (inv) {
            inv.status = inv.status === 'ativo' ? 'resgatado' : 'ativo';
            await upsertData('investimentos', inv);
            await loadData();
            refreshAll();
        }
    }

    function deleteInvestimento(id) {
        showConfirm('Tem certeza que deseja excluir este investimento?', async () => {
            await deleteData('investimentos', id);
            await loadData();
            refreshAll();
        });
    }

    // =========================================
    // POUPANÇA CRUD
    // =========================================
    function openPoupancaModal(id) {
        const form = $('#formPoupanca');
        form.reset();
        $('#poupancaId').value = '';
        $('#modalPoupancaTitle').textContent = 'Nova Reserva';

        if (id) {
            const p = poupancas.find(x => x.id === id);
            if (p) {
                $('#modalPoupancaTitle').textContent = 'Editar Reserva';
                $('#poupancaId').value = p.id;
                $('#poupancaNome').value = p.nome;
                $('#poupancaMeta').value = p.meta;
                $('#poupancaAtual').value = p.atual;
                $('#poupancaCor').value = p.icone;
            }
        }

        openModal('modalPoupanca');
    }

    async function handlePoupancaSubmit(e) {
        e.preventDefault();
        const id = $('#poupancaId').value;
        const item = {
            id: id || generateId(),
            nome: $('#poupancaNome').value.trim(),
            meta: parseFloat($('#poupancaMeta').value),
            atual: parseFloat($('#poupancaAtual').value),
            icone: $('#poupancaCor').value,
            criado_em: new Date().toISOString(),
        };

        if (id) {
            const idx = poupancas.findIndex(x => x.id === id);
            if (idx !== -1) {
                item.criado_em = poupancas[idx].criado_em;
            }
        }

        await upsertData('poupancas', item);
        await loadData();
        closeModal('modalPoupanca');
        refreshAll();
    }

    function openAddPoupanca(id) {
        $('#addPoupancaId').value = id;
        $('#addPoupancaValor').value = '';
        openModal('modalAddPoupanca');
    }

    async function handleAddPoupancaSubmit(e) {
        e.preventDefault();
        const id = $('#addPoupancaId').value;
        const valor = parseFloat($('#addPoupancaValor').value);
        const p = poupancas.find(x => x.id === id);
        if (p && !isNaN(valor)) {
            p.atual = Math.max(0, p.atual + valor);
            await upsertData('poupancas', p);
            await loadData();
        }
        closeModal('modalAddPoupanca');
        refreshAll();
    }

    function deletePoupanca(id) {
        showConfirm('Tem certeza que deseja excluir esta reserva?', async () => {
            await deleteData('poupancas', id);
            await loadData();
            refreshAll();
        });
    }

    // =========================================
    // CONFIRM MODAL
    // =========================================
    let confirmCallback = null;

    function showConfirm(text, callback) {
        $('#confirmText').textContent = text;
        confirmCallback = callback;
        openModal('modalConfirm');
    }

    function initConfirm() {
        $('#confirmDelete').addEventListener('click', () => {
            if (confirmCallback) confirmCallback();
            closeModal('modalConfirm');
            confirmCallback = null;
        });
    }

    // =========================================
    // DASHBOARD REFRESH
    // =========================================
    function refreshDashboard() {
        const cm = currentMonthStr();
        const today = todayStr();

        // Month transactions (only realized <= today for the main numbers)
        const mesTransacoes = transacoes.filter(t => getMonthYear(t.data) === cm);
        const receitas = mesTransacoes.filter(t => t.tipo === 'receita' && t.data <= today);
        const despesas = mesTransacoes.filter(t => t.tipo === 'despesa' && t.data <= today);
        const totalReceita = receitas.reduce((s, t) => s + t.valor, 0);
        const totalDespesa = despesas.reduce((s, t) => s + t.valor, 0);

        // Pending (scheduled for future dates)
        const pendentesReceita = transacoes.filter(t => t.tipo === 'receita' && t.data > today);
        const pendentesDespesa = transacoes.filter(t => t.tipo === 'despesa' && t.data > today);
        const totalPendReceita = pendentesReceita.reduce((s, t) => s + t.valor, 0);
        const totalPendDespesa = pendentesDespesa.reduce((s, t) => s + t.valor, 0);

        // All time balance (ONLY realized <= today)
        const allReceita = transacoes.filter(t => t.tipo === 'receita' && t.data <= today).reduce((s, t) => s + t.valor, 0);
        const allDespesa = transacoes.filter(t => t.tipo === 'despesa' && t.data <= today).reduce((s, t) => s + t.valor, 0);
        const saldoInicial = parseFloat(userSettings.saldoInicial) || 0;
        const saldo = allReceita - allDespesa + saldoInicial;

        // Savings & Investments
        const totalGuardado = poupancas.reduce((s, p) => s + p.atual, 0);
        const totalInvestido = investimentos.filter(i => i.status === 'ativo').reduce((s, i) => s + i.valor, 0);
        const patrimonio = saldo + totalGuardado + totalInvestido;

        // Update Dashboard Main Numbers
        $('#dashSaldo').textContent = formatCurrency(saldo);
        $('#dashReceita').textContent = formatCurrency(totalReceita);
        $('#dashDespesa').textContent = formatCurrency(totalDespesa);
        $('#dashPoupanca').textContent = formatCurrency(totalGuardado);
        $('#dashInvestido').textContent = formatCurrency(totalInvestido);
        $('#dashPatrimonio').textContent = formatCurrency(patrimonio);
        
        // Hide sections based on user settings
        const cardInvestimentos = $('#dashInvestido').closest('.card');
        const cardPoupanca = $('#dashPoupanca').closest('.card');
        const cardPatrimonio = $('#dashPatrimonio').closest('.card');
        
        if (cardInvestimentos) cardInvestimentos.style.display = userSettings.hideInvestimentos ? 'none' : 'block';
        if (cardPoupanca) cardPoupanca.style.display = userSettings.hidePoupanca ? 'none' : 'block';
        if (cardPatrimonio) cardPatrimonio.style.display = (userSettings.hideInvestimentos && userSettings.hidePoupanca) ? 'none' : 'block';

        const radarContainer = $('#radarGrid')?.closest('.card');
        if (radarContainer) radarContainer.style.display = userSettings.hideRadar ? 'none' : 'block';

        // Meta de Economia
        const metaContainer = $('#metaEconomiaContainer');
        if (metaContainer) {
            if (userSettings.metaEconomia > 0) {
                metaContainer.style.display = 'block';
                const economiaAtual = totalReceita - totalDespesa;
                const perc = Math.max(0, Math.min(100, (economiaAtual / userSettings.metaEconomia) * 100));
                $('#metaEconomiaBar').style.width = `${perc}%`;
                $('#metaEconomiaBar').style.background = economiaAtual >= userSettings.metaEconomia ? 'var(--positive)' : 'var(--white)';
                $('#metaEconomiaText').textContent = `${formatCurrency(economiaAtual)} / ${formatCurrency(userSettings.metaEconomia)}`;
            } else {
                metaContainer.style.display = 'none';
            }
        }

        // Pending Bar visibility
        const pendingBar = $('#pendingBar');
        if (pendingBar) {
            if (totalPendReceita > 0 || totalPendDespesa > 0) {
                pendingBar.style.display = 'flex';
                $('#pendReceita').textContent = formatCurrency(totalPendReceita);
                $('#pendDespesa').textContent = formatCurrency(totalPendDespesa);
            } else {
                pendingBar.style.display = 'none';
            }
        }

        // Recorrentes Alert Logic (Due in next 5 days)
        const recorrentesAlert = $('#recorrentesAlert');
        const recorrentesAlertList = $('#recorrentesAlertList');
        if (recorrentesAlert && recorrentesAlertList) {
            const todayDate = new Date().getDate();
            const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
            
            const dueSoon = recorrentes.filter(r => {
                if (r.tipo !== 'despesa') return false;
                
                // Calculate days until due
                let daysUntilDue = r.dia - todayDate;
                
                // Handle end-of-month wrap around (e.g., today is 28, due is 2)
                if (daysUntilDue < 0) {
                    daysUntilDue += daysInMonth;
                }
                
                const alertDays = userSettings.alertDays || 5;
                return daysUntilDue >= 0 && daysUntilDue <= alertDays;
            });

            if (dueSoon.length > 0) {
                recorrentesAlert.style.display = 'block';
                // Sort by due date
                dueSoon.sort((a, b) => {
                    let dA = a.dia - todayDate; if (dA < 0) dA += daysInMonth;
                    let dB = b.dia - todayDate; if (dB < 0) dB += daysInMonth;
                    return dA - dB;
                });
                
                recorrentesAlertList.innerHTML = dueSoon.map(r => {
                    let d = r.dia - todayDate;
                    if (d < 0) d += daysInMonth;
                    const daysText = d === 0 ? '<strong>Hoje</strong>' : `em ${d} dia${d > 1 ? 's' : ''}`;
                    return `<div>- <strong>${r.descricao}</strong>: ${formatCurrency(r.valor)} (Vence ${daysText})</div>`;
                }).join('');
            } else {
                recorrentesAlert.style.display = 'none';
            }
        }

        // Update cards with animation
        animateCurrency($('#saldoAtual'), saldo);
        $('#saldoAtual').className = 'card-value' + (saldo >= 0 ? '' : ' negative');
        
        animateCurrency($('#receitaMes'), totalReceita);
        $('#receitaCount').textContent = `${receitas.length} entrada${receitas.length !== 1 ? 's' : ''}`;
        
        animateCurrency($('#despesaMes'), totalDespesa);
        $('#despesaCount').textContent = `${despesas.length} saída${despesas.length !== 1 ? 's' : ''}`;
        
        animateCurrency($('#totalGuardado'), totalGuardado);
        animateCurrency($('#totalInvestido'), totalInvestido);
        $('#investCount').textContent = `${investimentos.filter(i => i.status === 'ativo').length} ativo${investimentos.filter(i => i.status === 'ativo').length !== 1 ? 's' : ''}`;
        
        animateCurrency($('#patrimonioTotal'), patrimonio);

        // Recent transactions (last 8)
        const recent = [...transacoes].sort((a, b) => b.data.localeCompare(a.data) || b.criado_em.localeCompare(a.criado_em)).slice(0, 8);
        const container = $('#recentTransactions');

        if (recent.length === 0) {
            container.innerHTML = `<div class="empty-state"><p>Nenhuma transação registrada ainda.</p><p class="empty-hint">Clique em "+ Nova Transação" para começar.</p></div>`;
        } else {
            container.innerHTML = recent.map(t => `
                <div class="transaction-item">
                    <div class="transaction-left">
                        <div class="transaction-cat-icon">${CATEGORY_ICONS[t.categoria] || svgIcon(SVG_PATHS.dollar)}</div>
                        <div class="transaction-info">
                            <span class="transaction-desc">${escapeHtml(t.descricao)} ${t.data > today ? '<span class="badge badge-agendado">Agendado</span>' : ''}</span>
                            <span class="transaction-meta">${t.categoria} · ${formatDate(t.data)}</span>
                        </div>
                    </div>
                    <span class="transaction-amount ${t.tipo === 'receita' ? 'positive' : 'negative'}">
                        ${t.tipo === 'receita' ? '+' : '-'} ${formatCurrency(t.valor)}
                    </span>
                </div>
            `).join('');
        }

        // Draw charts
        drawFluxoChart();
        drawCategoriasChart();
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // =========================================
    // TRANSAÇÕES VIEW
    // =========================================
    function refreshTransacoes() {
        const filterTipo = $('#filterTipo').value;
        const filterCat = $('#filterCategoria').value;
        const filterText = $('#filterText').value.toLowerCase();
        const showAllMonths = $('#filterAllMonths') && $('#filterAllMonths').checked;
        const currentMonth = currentMonthStr();

        let filtered = [...transacoes];
        
        // Only filter by month if "Todos os meses" is NOT checked
        if (!showAllMonths) {
            filtered = filtered.filter(t => getMonthYear(t.data) === currentMonth);
        }

        if (filterText) {
            filtered = filtered.filter(t => t.descricao.toLowerCase().includes(filterText) || t.categoria.toLowerCase().includes(filterText));
        }
        if (filterTipo !== 'todos') {
            filtered = filtered.filter(t => t.tipo === filterTipo);
        }
        if (filterCat !== 'todos') {
            filtered = filtered.filter(t => t.categoria === filterCat);
        }

        filtered.sort((a, b) => b.data.localeCompare(a.data) || b.criado_em.localeCompare(a.criado_em));

        // Summary (only realized)
        const today = todayStr();
        const realized = filtered.filter(t => t.data <= today);
        const totalR = realized.filter(t => t.tipo === 'receita').reduce((s, t) => s + t.valor, 0);
        const totalD = realized.filter(t => t.tipo === 'despesa').reduce((s, t) => s + t.valor, 0);
        $('#filtroReceita').textContent = formatCurrency(totalR);
        $('#filtroDespesa').textContent = formatCurrency(totalD);
        const bal = totalR - totalD;
        $('#filtroBalanco').textContent = formatCurrency(bal);
        $('#filtroBalanco').className = 'mini-value' + (bal >= 0 ? '' : ' negative');

        // Table
        const tbody = $('#transacoesBody');
        const emptyEl = $('#transacoesEmpty');

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            emptyEl.style.display = 'block';
            $('#tabelaTransacoes').style.display = 'none';
        } else {
            emptyEl.style.display = 'none';
            $('#tabelaTransacoes').style.display = 'table';
            tbody.innerHTML = filtered.map(t => `
                <tr>
                    <td>${formatDate(t.data)}</td>
                    <td>${escapeHtml(t.descricao)}</td>
                    <td>${t.categoria}</td>
                    <td><span class="badge badge-${t.tipo}">${t.tipo === 'receita' ? 'Receita' : 'Despesa'}</span> ${t.data > today ? '<span class="badge badge-agendado">Agendado</span>' : ''}</td>
                    <td class="${t.tipo === 'receita' ? 'positive' : 'negative'}">${t.tipo === 'receita' ? '+' : '-'} ${formatCurrency(t.valor)}</td>
                    <td>
                        <div class="action-btns">
                            <button class="action-btn" title="Editar" onclick="window.porquimEditTransacao('${t.id}')">${ICON_EDIT}</button>
                            <button class="action-btn" title="Excluir" onclick="window.porquimDeleteTransacao('${t.id}')">${ICON_TRASH}</button>
                        </div>
                    </td>
                </tr>
            `).join('');
        }

        // Populate category filter
        const cats = [...new Set(transacoes.map(t => t.categoria))].sort();
        const catSelect = $('#filterCategoria');
        const currentVal = catSelect.value;
        catSelect.innerHTML = '<option value="todos">Todas categorias</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
        catSelect.value = currentVal || 'todos';
    }

    function initTransacaoFilters() {
        $('#filterTipo').addEventListener('change', refreshTransacoes);
        $('#filterCategoria').addEventListener('change', refreshTransacoes);
        $('#filterText').addEventListener('input', refreshTransacoes);
        
        // "Todos os meses" toggle
        const allMonthsCheckbox = $('#filterAllMonths');
        if (allMonthsCheckbox) {
            allMonthsCheckbox.addEventListener('change', refreshTransacoes);
        }
        
        // "Limpar tudo" button - deletes all transactions and resets balance
        const btnLimpar = $('#btnLimparTransacoes');
        if (btnLimpar) {
            btnLimpar.addEventListener('click', () => {
                if (transacoes.length === 0) {
                    showToast('Não há transações para excluir.', 'error');
                    return;
                }
                showConfirm(`Tem certeza que deseja excluir TODAS as ${transacoes.length} transações? Isso vai zerar o saldo completamente. Esta ação não pode ser desfeita.`, async () => {
                    try {
                        for (const t of transacoes) {
                            await deleteData('transacoes', t.id);
                        }
                        await loadData();
                        refreshAll();
                        showToast('Todas as transações foram excluídas. Saldo zerado.', 'success');
                    } catch (err) {
                        showToast('Erro ao excluir transações: ' + err.message, 'error');
                    }
                });
            });
        }
        
        $('#btnExportCSV').addEventListener('click', () => exportToCSV());
        $('#btnExportPDF').addEventListener('click', () => exportToPDF());
    }

    function exportToCSV() {
        if (transacoes.length === 0) return showToast('Nenhuma transação para exportar.', 'error');
        const headers = ['Data,Descricao,Categoria,Tipo,Valor'];
        const rows = transacoes.map(t => `${t.data},"${t.descricao}",${t.categoria},${t.tipo},${t.valor}`);
        const csvContent = headers.concat(rows).join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `porcada_transacoes_${todayStr()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function exportToPDF() {
        if (transacoes.length === 0) return showToast('Nenhuma transação para exportar.', 'error');
        if (!window.jspdf) return showToast('Biblioteca PDF carregando...', 'error');
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFontSize(16);
        doc.text('Porcada - Extrato de Transações', 14, 20);
        
        const tableData = transacoes.map(t => [
            formatDate(t.data),
            t.descricao,
            t.categoria,
            t.tipo === 'receita' ? 'Receita' : 'Despesa',
            formatCurrency(t.valor)
        ]);
        
        doc.autoTable({
            startY: 30,
            head: [['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor']],
            body: tableData,
            theme: 'grid',
            headStyles: { fillColor: [0, 0, 0] }
        });
        
        doc.save(`porcada_transacoes_${todayStr()}.pdf`);
    }

    // =========================================
    // INVESTIMENTOS VIEW
    // =========================================
    async function refreshInvestimentos() {
        const ativos = investimentos.filter(i => i.status === 'ativo');
        const totalAplicado = ativos.reduce((s, i) => s + i.valor, 0);

        // Fetch cotacoes via Brapi for ativos that have a Ticker
        const tickersToFetch = [...new Set(ativos.map(i => i.ticker).filter(t => t && t.length > 0))];
        let quotes = {};

        if (tickersToFetch.length > 0) {
            try {
                const data = await fetchWithCache('brapi_user_stocks', 5 * 60 * 1000, async () => {
                    const res = await fetchProxy('brapi-quote', { tickers: tickersToFetch });
                    if (!res.ok) throw new Error('Falha Brapi User');
                    return await res.json();
                });
                if (data.results) {
                    data.results.forEach(q => {
                        quotes[q.symbol] = q.regularMarketPrice;
                    });
                }
            } catch (e) {
                console.error('Erro ao buscar cotações da Brapi:', e);
            }
        }

        // Estimate total return (simplified annual for Renda Fixa + Cotação for Renda Variável)
        let totalRendimento = 0;
        let totalPatrimonioVariavel = 0;

        const tbodyHtml = investimentos.map(inv => {
            let rendimentoExibicao = '-';
            let valorAtual = inv.valor;

            if (inv.status === 'ativo') {
                if (inv.ticker && quotes[inv.ticker]) {
                    // For stocks, assume we bought 'quantidade = valor / (we don't have this, so let's simplify)'
                    // Actually without quantity, we can't calculate patrimônio exactly.
                    // Let's assume the user entered the total amount they invested. 
                    // To show a realistic quote we just show the current price of the ticker.
                    rendimentoExibicao = `R$ ${quotes[inv.ticker].toFixed(2)} (Cotação)`;
                } else if (inv.rendimento > 0) {
                    const days = Math.max(1, Math.floor((new Date() - new Date(inv.data)) / (1000 * 60 * 60 * 24)));
                    const years = days / 365;
                    const rend = inv.valor * (inv.rendimento / 100) * years;
                    totalRendimento += rend;
                    rendimentoExibicao = `${inv.rendimento}% a.a. (+${formatCurrency(rend)})`;
                }
            }

            return `
                <tr>
                    <td>${escapeHtml(inv.nome)}</td>
                    <td>${inv.ticker ? '<span class="badge" style="background:#555;">'+escapeHtml(inv.ticker)+'</span>' : '-'}</td>
                    <td>${inv.tipo}</td>
                    <td>${formatCurrency(inv.valor)}</td>
                    <td>${formatDate(inv.data)}</td>
                    <td>${rendimentoExibicao}</td>
                    <td><span class="badge badge-${inv.status}">${inv.status === 'ativo' ? 'Ativo' : 'Resgatado'}</span></td>
                    <td>
                        <div class="action-btns">
                            <button class="action-btn" title="${inv.status === 'ativo' ? 'Resgatar' : 'Reativar'}" onclick="window.porquimToggleInvStatus('${inv.id}')">${inv.status === 'ativo' ? ICON_ARROW_UP : ICON_ARROW_DOWN}</button>
                            <button class="action-btn" title="Editar" onclick="window.porquimEditInvestimento('${inv.id}')">${ICON_EDIT}</button>
                            <button class="action-btn" title="Excluir" onclick="window.porquimDeleteInvestimento('${inv.id}')">${ICON_TRASH}</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        $('#invTotalAplicado').textContent = formatCurrency(totalAplicado);
        $('#invRendimento').textContent = formatCurrency(totalRendimento);
        $('#invAtivos').textContent = ativos.length.toString();

        const tbody = $('#investimentosBody');
        const emptyEl = $('#investimentosEmpty');

        if (investimentos.length === 0) {
            tbody.innerHTML = '';
            emptyEl.style.display = 'block';
            $('#tabelaInvestimentos').style.display = 'none';
        } else {
            emptyEl.style.display = 'none';
            $('#tabelaInvestimentos').style.display = 'table';
            tbody.innerHTML = tbodyHtml;
        }

        // Initialize market dashboard when this view is rendered
        loadMarketDashboard();
    }


    // =========================================
    // POUPANÇA VIEW
    // =========================================
    function refreshPoupanca() {
        const totalGuardado = poupancas.reduce((s, p) => s + p.atual, 0);
        const totalMeta = poupancas.reduce((s, p) => s + p.meta, 0);
        const progresso = totalMeta > 0 ? Math.round((totalGuardado / totalMeta) * 100) : 0;

        // Rendimento Mensal (100% CDI / Selic approx)
        const rendimentoMensal = totalGuardado * ((selicRate / 100) / 12);

        $('#poupTotal').textContent = formatCurrency(totalGuardado);
        $('#poupMeta').textContent = formatCurrency(totalMeta);
        $('#poupProgresso').textContent = progresso + '%';
        if ($('#poupRendimento')) {
            $('#poupRendimento').textContent = '+' + formatCurrency(rendimentoMensal);
        }

        const grid = $('#savingsGrid');
        if (poupancas.length === 0) {
            grid.innerHTML = '<div class="empty-state"><p>Nenhuma reserva criada ainda.</p></div>';
        } else {
            grid.innerHTML = poupancas.map(p => {
                const pct = p.meta > 0 ? Math.min(100, Math.round((p.atual / p.meta) * 100)) : 0;
                return `
                    <div class="savings-card">
                        <div class="savings-card-header">
                            <div class="savings-card-name">
                                <span class="savings-icon">${SAVINGS_ICONS[p.icone] || '●'}</span>
                                <span class="savings-title">${escapeHtml(p.nome)}</span>
                            </div>
                            <div class="savings-card-actions">
                                <button class="action-btn" title="Editar" onclick="window.porquimEditPoupanca('${p.id}')">${ICON_EDIT}</button>
                                <button class="action-btn" title="Excluir" onclick="window.porquimDeletePoupanca('${p.id}')">${ICON_TRASH}</button>
                            </div>
                        </div>
                        <div class="savings-amounts">
                            <div>
                                <div class="savings-current">${formatCurrency(p.atual)}</div>
                                <div class="savings-meta">de ${formatCurrency(p.meta)}</div>
                            </div>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${pct}%"></div>
                        </div>
                        <div class="savings-percent">${pct}% da meta</div>
                        <div class="savings-bottom-actions">
                            <button class="btn-secondary btn-sm" onclick="window.porquimAddPoupanca('${p.id}')">+ Adicionar / Retirar</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // =========================================
    // METAS VIEW
    // =========================================
    function refreshMetas() {
        const grid = $('#metasGrid');
        const emptyEl = $('#metasEmpty');
        
        if (metas.length === 0) {
            if(grid) grid.innerHTML = '';
            if(emptyEl) emptyEl.style.display = 'block';
            return;
        }
        
        if(emptyEl) emptyEl.style.display = 'none';
        
        const currentMonth = currentMonthStr();
        const despesasMes = transacoes.filter(t => t.tipo === 'despesa' && getMonthYear(t.data) === currentMonth);
        
        if(grid) grid.innerHTML = metas.map(meta => {
            const gastoCat = despesasMes.filter(t => t.categoria === meta.categoria).reduce((s, t) => s + t.valor, 0);
            let pct = (gastoCat / meta.valor_limite) * 100;
            if (pct > 100) pct = 100;
            
            const isOver = gastoCat > meta.valor_limite;
            const barBg = isOver ? 'var(--negative)' : 'var(--white)';
            const textClass = isOver ? 'negative' : 'positive';
            
            return `
                <div class="savings-card">
                    <div class="savings-card-header">
                        <div class="savings-card-name">
                            <span class="savings-icon">${CATEGORY_ICONS[meta.categoria] || '📌'}</span>
                            <span class="savings-title">${meta.categoria}</span>
                        </div>
                        <div class="savings-card-actions">
                            <button class="action-btn" title="Editar" onclick="window.porquimEditMeta('${meta.id}')">${ICON_EDIT}</button>
                            <button class="action-btn" title="Excluir" onclick="window.porquimDeleteMeta('${meta.id}')">${ICON_TRASH}</button>
                        </div>
                    </div>
                    <div class="savings-amounts">
                        <span class="savings-current ${textClass}">${formatCurrency(gastoCat)}</span>
                        <span class="savings-meta">/ ${formatCurrency(meta.valor_limite)}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${pct}%; background: ${barBg};"></div>
                    </div>
                    <div class="savings-percent">${( (gastoCat / meta.valor_limite) * 100 ).toFixed(1)}% utilizado</div>
                </div>
            `;
        }).join('');
    }

    function openMetaModal(id = null) {
        $('#formMeta').reset();
        $('#metaId').value = '';
        
        if (id) {
            const meta = metas.find(m => m.id === id);
            if (meta) {
                $('#metaId').value = meta.id;
                $('#metaCategoria').value = meta.categoria;
                $('#metaValor').value = meta.valor_limite;
                $('#modalMetaTitle').textContent = 'Editar Meta';
            }
        } else {
            $('#modalMetaTitle').textContent = 'Nova Meta';
        }
        openModal('modalMeta');
    }

    async function handleMetaSubmit(e) {
        e.preventDefault();
        const id = $('#metaId').value;
        const item = {
            id: id || generateId(),
            categoria: $('#metaCategoria').value,
            valor_limite: parseFloat($('#metaValor').value)
        };
        
        await upsertData('metas', item);
        await loadData();
        refreshMetas();
        closeModal('modalMeta');
    }

    function deleteMeta(id) {
        window.confirmAction('Excluir esta meta?', async () => {
            await deleteData('metas', id);
            await loadData();
            refreshMetas();
        });
    }

    window.porquimEditMeta = (id) => openMetaModal(id);
    window.porquimDeleteMeta = (id) => deleteMeta(id);

    // =========================================
    // RELATÓRIOS VIEW
    // =========================================
    function refreshRelatorios() {
        const period = $('#reportPeriod').value;
        const now = new Date();
        let startDate;

        switch (period) {
            case 'mes':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'trimestre':
                startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
                break;
            case 'semestre':
                startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
                break;
            case 'ano':
                startDate = new Date(now.getFullYear(), 0, 1);
                break;
            default:
                startDate = new Date(2000, 0, 1);
        }

        const startStr = startDate.toISOString().split('T')[0];
        const filtered = transacoes.filter(t => t.data >= startStr);

        const receitas = filtered.filter(t => t.tipo === 'receita');
        const despesas = filtered.filter(t => t.tipo === 'despesa');
        const totalR = receitas.reduce((s, t) => s + t.valor, 0);
        const totalD = despesas.reduce((s, t) => s + t.valor, 0);
        const balanco = totalR - totalD;

        // Days in period
        const days = Math.max(1, Math.floor((now - startDate) / (1000 * 60 * 60 * 24)));
        const mediaDia = totalD / days;

        const maiorDespesa = despesas.length > 0 ? despesas.reduce((max, t) => t.valor > max.valor ? t : max) : null;
        const maiorReceita = receitas.length > 0 ? receitas.reduce((max, t) => t.valor > max.valor ? t : max) : null;

        $('#rpReceita').textContent = formatCurrency(totalR);
        $('#rpDespesa').textContent = formatCurrency(totalD);
        $('#rpBalanco').textContent = formatCurrency(balanco);
        $('#rpBalanco').className = balanco >= 0 ? '' : 'negative';
        $('#rpMediaDia').textContent = formatCurrency(mediaDia);
        $('#rpMaiorDespesa').textContent = maiorDespesa ? `${escapeHtml(maiorDespesa.descricao)} (${formatCurrency(maiorDespesa.valor)})` : '-';
        $('#rpMaiorReceita').textContent = maiorReceita ? `${escapeHtml(maiorReceita.descricao)} (${formatCurrency(maiorReceita.valor)})` : '-';

        // Category breakdown
        const catTotals = {};
        despesas.forEach(t => {
            catTotals[t.categoria] = (catTotals[t.categoria] || 0) + t.valor;
        });

        const catSorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
        const maxCat = catSorted.length > 0 ? catSorted[0][1] : 1;

        const catContainer = $('#reportCategorias');
        if (catSorted.length === 0) {
            catContainer.innerHTML = '<p class="empty-hint">Sem dados ainda.</p>';
        } else {
            catContainer.innerHTML = catSorted.map(([cat, val]) => `
                <div class="cat-bar-row">
                    <span class="cat-bar-label">${cat}</span>
                    <div class="cat-bar-track">
                        <div class="cat-bar-fill" style="width: ${(val / maxCat) * 100}%"></div>
                    </div>
                    <span class="cat-bar-value">${formatCurrency(val)}</span>
                </div>
            `).join('');
        }

        drawPatrimonioChart();
    }

    function initRelatorioFilters() {
        $('#reportPeriod').addEventListener('change', refreshRelatorios);
    }

    // =========================================
    // CHARTS (Canvas 2D - No libraries)
    // =========================================
    let chartFluxoInstance = null;

    function drawFluxoChart() {
        const canvas = $('#chartFluxo');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        
        if (chartFluxoInstance) {
            chartFluxoInstance.destroy();
        }

        const months = [];
        const labels = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            months.push(mStr);
            labels.push(getMonthName(mStr));
        }

        const receitaData = months.map(m => transacoes.filter(t => t.tipo === 'receita' && getMonthYear(t.data) === m).reduce((s, t) => s + t.valor, 0));
        const despesaData = months.map(m => transacoes.filter(t => t.tipo === 'despesa' && getMonthYear(t.data) === m).reduce((s, t) => s + t.valor, 0));

        const gradReceita = ctx.createLinearGradient(0, 0, 0, 400);
        gradReceita.addColorStop(0, 'rgba(76, 175, 80, 0.9)');
        gradReceita.addColorStop(1, 'rgba(76, 175, 80, 0.2)');
        
        const gradDespesa = ctx.createLinearGradient(0, 0, 0, 400);
        gradDespesa.addColorStop(0, 'rgba(255, 82, 82, 0.9)');
        gradDespesa.addColorStop(1, 'rgba(255, 82, 82, 0.2)');

        chartFluxoInstance = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Receitas',
                        data: receitaData,
                        backgroundColor: gradReceita,
                        borderRadius: 6,
                        barPercentage: 0.6,
                        categoryPercentage: 0.8,
                        hoverBackgroundColor: '#4CAF50'
                    },
                    {
                        label: 'Despesas',
                        data: despesaData,
                        backgroundColor: gradDespesa,
                        borderRadius: 6,
                        barPercentage: 0.6,
                        categoryPercentage: 0.8,
                        hoverBackgroundColor: '#FF5252'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 1000,
                    easing: 'easeOutQuart'
                },
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end',
                        labels: {
                            color: '#cccccc',
                            font: { family: 'Inter', size: 12 },
                            usePointStyle: true,
                            boxWidth: 8
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(20, 20, 20, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#cccccc',
                        titleFont: { family: 'Inter', size: 13 },
                        bodyFont: { family: 'Inter', size: 12 },
                        padding: 12,
                        cornerRadius: 8,
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false,
                            drawBorder: false
                        },
                        ticks: {
                            color: '#888888',
                            font: { family: 'Inter', size: 11 }
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(255,255,255,0.05)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#888888',
                            font: { family: 'Inter', size: 11 },
                            callback: function(value) {
                                return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumSignificantDigits: 3 }).format(value);
                            }
                        }
                    }
                }
            }
        });
    }

    let chartCategoriasInstance = null;

    function drawCategoriasChart() {
        const canvas = $('#chartCategorias');
        if (!canvas) return;
        
        if (chartCategoriasInstance) {
            chartCategoriasInstance.destroy();
        }

        const cm = currentMonthStr();
        const despesas = transacoes.filter(t => t.tipo === 'despesa' && getMonthYear(t.data) === cm);

        if (despesas.length === 0) {
            // Se não houver despesas, cria um gráfico vazio sutil
            chartCategoriasInstance = new Chart(canvas, {
                type: 'doughnut',
                data: {
                    labels: ['Sem despesas'],
                    datasets: [{
                        data: [1],
                        backgroundColor: ['#333333'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '70%',
                    plugins: { tooltip: { enabled: false }, legend: { display: false } }
                }
            });
            return;
        }

        const catTotals = {};
        despesas.forEach(t => {
            catTotals[t.categoria] = (catTotals[t.categoria] || 0) + t.valor;
        });

        const cats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
        const labels = cats.map(c => c[0]);
        const data = cats.map(c => c[1]);

        // Paleta apenas com vermelho e verde, como solicitado
        const premiumColors = [
            '#FF5252', // Red
            '#4CAF50', // Green
            '#FF1744', // Red A400
            '#00E676', // Green A400
            '#D50000', // Red A700
            '#00C853', // Green A700
            '#FF8A80', // Red A100
            '#B2FF59', // Light Green A200
            '#E53935', // Red 600
            '#43A047'  // Green 600
        ];

        chartCategoriasInstance = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: premiumColors.slice(0, labels.length),
                    borderWidth: 2,
                    borderColor: '#1a1a1a', // Match background
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                animation: {
                    animateScale: true,
                    animateRotate: true,
                    duration: 1000,
                    easing: 'easeOutQuart'
                },
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#cccccc',
                            font: { family: 'Inter', size: 11 },
                            usePointStyle: true,
                            boxWidth: 8,
                            padding: 15
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(20, 20, 20, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#cccccc',
                        padding: 12,
                        cornerRadius: 8,
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                let label = context.label || '';
                                if (label) label += ': ';
                                if (context.parsed !== null) {
                                    label += new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed);
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
    }

    let chartPatrimonioInstance = null;

    function drawPatrimonioChart() {
        const canvas = $('#chartPatrimonio');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        
        if (chartPatrimonioInstance) {
            chartPatrimonioInstance.destroy();
        }

        // Build monthly patrimony evolution (last 12 months)
        const months = [];
        const labels = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const mStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            months.push(mStr);
            labels.push(getMonthName(mStr));
        }

        // Cumulative balance up to each month
        const data = months.map(m => {
            const allBefore = transacoes.filter(t => getMonthYear(t.data) <= m);
            const r = allBefore.filter(t => t.tipo === 'receita').reduce((s, t) => s + t.valor, 0);
            const d = allBefore.filter(t => t.tipo === 'despesa').reduce((s, t) => s + t.valor, 0);
            return r - d;
        });

        if (data.every(v => v === 0)) {
            chartPatrimonioInstance = new Chart(canvas, {
                type: 'line',
                data: { labels: ['Sem dados'], datasets: [{ data: [0] }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
            return;
        }

        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(76, 175, 80, 0.5)'); // Green glow
        gradient.addColorStop(1, 'rgba(76, 175, 80, 0.0)');

        chartPatrimonioInstance = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Patrimônio',
                    data: data,
                    borderColor: '#4CAF50',
                    borderWidth: 3,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.4, // Smooth curves
                    pointBackgroundColor: '#1a1a1a',
                    pointBorderColor: '#4CAF50',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 1200,
                    easing: 'easeOutQuart'
                },
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(20, 20, 20, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#cccccc',
                        padding: 12,
                        cornerRadius: 8,
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false, drawBorder: false },
                        ticks: { color: '#888888', font: { family: 'Inter', size: 11 } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                        ticks: {
                            color: '#888888',
                            font: { family: 'Inter', size: 11 },
                            callback: function(value) {
                                return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumSignificantDigits: 3 }).format(value);
                            }
                        }
                    }
                }
            }
        });
    }

    // =========================================
    // GLOBAL ACTIONS (for onclick in innerHTML)
    // =========================================
    window.porquimEditTransacao = (id) => openTransacaoModal(id);
    window.porquimDeleteTransacao = (id) => deleteTransacao(id);
    window.porquimEditInvestimento = (id) => openInvestimentoModal(id);
    window.porquimDeleteInvestimento = (id) => deleteInvestimento(id);
    window.porquimToggleInvStatus = (id) => toggleInvestimentoStatus(id);
    window.porquimEditPoupanca = (id) => openPoupancaModal(id);
    window.porquimDeletePoupanca = (id) => deletePoupanca(id);
    window.porquimAddPoupanca = (id) => openAddPoupanca(id);

    // =========================================
    // RECORRENTES CRUD & VIEW
    // =========================================
    function openRecorrenteModal(id) {
        const form = $('#formRecorrente');
        if (!form) return;
        form.reset();
        $('#recorrenteId').value = '';
        $('#modalRecorrenteTitle').textContent = 'Nova Transação Recorrente';

        if (id) {
            const r = recorrentes.find(x => x.id === id);
            if (r) {
                $('#modalRecorrenteTitle').textContent = 'Editar Recorrente';
                $('#recorrenteId').value = r.id;
                $('#recorrenteDescricao').value = r.descricao;
                $('#recorrenteTipo').value = r.tipo;
                $('#recorrenteValor').value = r.valor;
                $('#recorrenteCategoria').value = r.categoria;
                $('#recorrenteDia').value = r.dia;
            }
        }
        openModal('modalRecorrente');
    }

    async function handleRecorrenteSubmit(e) {
        e.preventDefault();
        const id = $('#recorrenteId').value;
        const item = {
            id: id || generateId(),
            descricao: $('#recorrenteDescricao').value.trim(),
            tipo: $('#recorrenteTipo').value,
            valor: parseFloat($('#recorrenteValor').value),
            categoria: $('#recorrenteCategoria').value,
            dia: parseInt($('#recorrenteDia').value, 10),
            criado_em: new Date().toISOString(),
        };

        if (id) {
            const idx = recorrentes.findIndex(x => x.id === id);
            if (idx !== -1) {
                item.criado_em = recorrentes[idx].criado_em;
            }
        }

        await upsertData('recorrentes', item);
        await loadData();
        closeModal('modalRecorrente');
        refreshAll();
    }

    function deleteRecorrente(id) {
        showConfirm('Tem certeza que deseja excluir esta transação recorrente?', async () => {
            await deleteData('recorrentes', id);
            await loadData();
            refreshAll();
        });
    }

    function registrarRecorrente(id) {
        const r = recorrentes.find(x => x.id === id);
        if (!r) return;
        
        // Open transaction modal pre-filled with this data
        openTransacaoModal();
        $('#transacaoTipo').value = r.tipo;
        $('#transacaoValor').value = r.valor;
        $('#transacaoDescricao').value = r.descricao;
        $('#transacaoCategoria').value = r.categoria;
        
        // Guess the date for this month based on 'dia'
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(Math.min(r.dia, new Date(year, d.getMonth() + 1, 0).getDate())).padStart(2, '0');
        $('#transacaoData').value = `${year}-${month}-${day}`;
    }

    function refreshRecorrentes() {
        const recReceitas = recorrentes.filter(r => r.tipo === 'receita');
        const recDespesas = recorrentes.filter(r => r.tipo === 'despesa');
        const tReceita = recReceitas.reduce((s, r) => s + r.valor, 0);
        const tDespesa = recDespesas.reduce((s, r) => s + r.valor, 0);

        $('#recFixaReceita').textContent = formatCurrency(tReceita);
        $('#recFixaDespesa').textContent = formatCurrency(tDespesa);
        const bal = tReceita - tDespesa;
        $('#recFixaBalanco').textContent = formatCurrency(bal);
        $('#recFixaBalanco').className = 'mini-value' + (bal >= 0 ? '' : ' negative');

        const tbody = $('#recorrentesBody');
        const emptyEl = $('#recorrentesEmpty');

        if (recorrentes.length === 0) {
            tbody.innerHTML = '';
            emptyEl.style.display = 'block';
            $('#tabelaRecorrentes').style.display = 'none';
        } else {
            emptyEl.style.display = 'none';
            $('#tabelaRecorrentes').style.display = 'table';
            
            const sorted = [...recorrentes].sort((a, b) => a.dia - b.dia);
            
            tbody.innerHTML = sorted.map(r => `
                <tr>
                    <td>${escapeHtml(r.descricao)}</td>
                    <td><span class="badge badge-${r.tipo}">${r.tipo === 'receita' ? 'Receita' : 'Despesa'}</span></td>
                    <td>${r.categoria}</td>
                    <td class="${r.tipo === 'receita' ? 'positive' : 'negative'}">${r.tipo === 'receita' ? '+' : '-'} ${formatCurrency(r.valor)}</td>
                    <td>Dia ${r.dia}</td>
                    <td><button class="btn-register" onclick="window.porquimRegistrarRecorrente('${r.id}')">Registrar</button></td>
                    <td>
                        <div class="action-btns">
                            <button class="action-btn" title="Editar" onclick="window.porquimEditRecorrente('${r.id}')">${ICON_EDIT}</button>
                            <button class="action-btn" title="Excluir" onclick="window.porquimDeleteRecorrente('${r.id}')">${ICON_TRASH}</button>
                        </div>
                    </td>
                </tr>
            `).join('');
        }
    }

    window.porquimEditRecorrente = (id) => openRecorrenteModal(id);
    window.porquimDeleteRecorrente = (id) => deleteRecorrente(id);
    window.porquimRegistrarRecorrente = (id) => registrarRecorrente(id);

    // Listeners Globais
    $('#formMeta').addEventListener('submit', handleMetaSubmit);

    // =========================================
    // SETTINGS MODAL
    // =========================================
    function populateSettingsForm() {
        $('#settingsNome').value = userSettings.nome || '';
        $('#settingsEmail').value = currentUser ? currentUser.email : '';
        $('#settingsSaldoInicial').value = userSettings.saldoInicial || '';
        $('#settingsDiaFechamento').value = userSettings.diaFechamento || 1;
        $('#settingsMetaEconomia').value = userSettings.metaEconomia || '';
        $('#settingsAlertDays').value = userSettings.alertDays || 5;
        $('#settingsDateFormat').value = userSettings.dateFormat || 'DD/MM/YYYY';
        
        $('#hideInvestimentos').checked = !!userSettings.hideInvestimentos;
        $('#hidePoupanca').checked = !!userSettings.hidePoupanca;
        $('#hideRadar').checked = !!userSettings.hideRadar;
        
        if($('#settingsEnableShortcuts')) {
            $('#settingsEnableShortcuts').checked = userSettings.enableShortcuts !== false;
        }
        
        // Update color swatches
        document.querySelectorAll('.color-swatch').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.color === (userSettings.accentColor || '#40C4FF'));
        });
        
        updateDatePreview();
        
        renderCustomCategories();
    }
    
    function renderCustomCategories() {
        const listReceita = $('#listCatReceita');
        const listDespesa = $('#listCatDespesa');
        if (!listReceita || !listDespesa) return;
        
        const renderTags = (arr, type) => arr.map(c => `
            <div class="tag-item">
                <span>${escapeHtml(c)}</span>
                <button type="button" onclick="window.porquimRemoveCustomCat('${escapeHtml(c)}', '${type}')">&times;</button>
            </div>
        `).join('');
        
        listReceita.innerHTML = renderTags(userSettings.customCategoriesReceita || [], 'receita');
        listDespesa.innerHTML = renderTags(userSettings.customCategoriesDespesa || [], 'despesa');
    }

    window.porquimRemoveCustomCat = (cat, type) => {
        if (type === 'receita') {
            userSettings.customCategoriesReceita = userSettings.customCategoriesReceita.filter(c => c !== cat);
        } else {
            userSettings.customCategoriesDespesa = userSettings.customCategoriesDespesa.filter(c => c !== cat);
        }
        renderCustomCategories();
        if (typeof populateCategorySelects === 'function') populateCategorySelects();
    };

    $('#formSettings').addEventListener('submit', (e) => {
        e.preventDefault();
        
        const btn = $('#btnSaveSettingsSubmit');
        const originalText = btn.querySelector('.save-text').textContent;
        const icon = btn.querySelector('.save-icon');
        const badge = $('#badgePendingSettings');
        
        userSettings.nome = $('#settingsNome').value.trim();
        userSettings.saldoInicial = parseFloat($('#settingsSaldoInicial').value) || 0;
        userSettings.diaFechamento = parseInt($('#settingsDiaFechamento').value) || 1;
        userSettings.metaEconomia = parseFloat($('#settingsMetaEconomia').value) || 0;
        userSettings.alertDays = parseInt($('#settingsAlertDays').value) || 5;
        userSettings.dateFormat = $('#settingsDateFormat').value;
        userSettings.hideInvestimentos = $('#hideInvestimentos').checked;
        userSettings.hidePoupanca = $('#hidePoupanca').checked;
        userSettings.hideRadar = $('#hideRadar').checked;
        
        if($('#settingsEnableShortcuts')) {
            userSettings.enableShortcuts = $('#settingsEnableShortcuts').checked;
        }
        
        const activeSwatch = document.querySelector('.color-swatch.active');
        if (activeSwatch) {
            userSettings.accentColor = activeSwatch.dataset.color;
            applyAccentColor(userSettings.accentColor);
        }
        
        saveSettings();
        
        updateGreeting();
        refreshDashboard();
        if (typeof populateCategorySelects === 'function') populateCategorySelects();
        
        // Button Animation
        btn.classList.add('saved');
        btn.querySelector('.save-text').textContent = 'Salvo!';
        icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
        if(badge) badge.style.display = 'none';
        
        showToast('Configurações salvas com sucesso!', 'success');
        
        setTimeout(() => {
            btn.classList.remove('saved');
            btn.querySelector('.save-text').textContent = originalText;
            icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
        }, 1500);
    });

    $('#btnAddCatReceita').addEventListener('click', () => {
        const v = $('#newCatReceitaInput').value.trim();
        if(v && !userSettings.customCategoriesReceita.includes(v)) {
            userSettings.customCategoriesReceita.push(v);
            $('#newCatReceitaInput').value = '';
            renderCustomCategories();
        }
    });

    $('#btnAddCatDespesa').addEventListener('click', () => {
        const v = $('#newCatDespesaInput').value.trim();
        if(v && !userSettings.customCategoriesDespesa.includes(v)) {
            userSettings.customCategoriesDespesa.push(v);
            $('#newCatDespesaInput').value = '';
            renderCustomCategories();
        }
    });

    $('#btnSettingsLogout').addEventListener('click', () => {
        showConfirm('Tem certeza que deseja sair?', async () => {
            await sbClient.auth.signOut();
        });
    });

    $('#btnClearCache').addEventListener('click', () => {
        showConfirm('Isso vai apagar dados cacheados como cotações e notícias. Continuar?', () => {
            localStorage.removeItem('porcada_news_cache');
            localStorage.removeItem('porcada_crypto_cache');
            localStorage.removeItem('porcada_stock_cache');
            showToast('Cache limpo.', 'success');
        });
    });

    // Settings Live Preview
    let greetingTimeout;
    $('#settingsNome').addEventListener('input', (e) => {
        clearTimeout(greetingTimeout);
        greetingTimeout = setTimeout(() => {
            const h2 = $('#greeting');
            if (h2) {
                const hour = new Date().getHours();
                let saudacao = 'Bom dia';
                if (hour >= 12 && hour < 18) saudacao = 'Boa tarde';
                else if (hour >= 18) saudacao = 'Boa noite';
                const n = e.target.value.trim();
                h2.textContent = n ? `${saudacao}, ${n}!` : `${saudacao}!`;
            }
        }, 300);
    });

    function updateDatePreview() {
        const fmt = $('#settingsDateFormat').value;
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const preview = $('#settingsDatePreview');
        if(preview) {
            preview.textContent = fmt === 'DD/MM/YYYY' ? `${dd}/${mm}/${yyyy}` : `${yyyy}-${mm}-${dd}`;
        }
    }
    $('#settingsDateFormat').addEventListener('change', updateDatePreview);

    // Show pending badge on any change
    $('#formSettings').addEventListener('input', () => {
        const badge = $('#badgePendingSettings');
        if (badge) badge.style.display = 'inline-block';
    });
    $('#formSettings').addEventListener('change', () => {
        const badge = $('#badgePendingSettings');
        if (badge) badge.style.display = 'inline-block';
    });

    // Color Swatches
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const hex = e.currentTarget.dataset.color;
            applyAccentColor(hex); // Live preview
            
            const badge = $('#badgePendingSettings');
            if (badge) badge.style.display = 'inline-block';
        });
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        if (userSettings.enableShortcuts === false) return;
        
        // Ignore if user is typing in an input
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        
        // Don't trigger if modifiers are pressed (except Shift)
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        
        const key = e.key.toUpperCase();
        
        switch(key) {
            case 'N':
                e.preventDefault();
                openModalTransacao();
                break;
            case 'D':
                switchView('dashboard');
                break;
            case 'T':
                switchView('transacoes');
                break;
            case 'R':
                switchView('recorrentes');
                break;
            case 'I':
                switchView('investimentos');
                break;
            case 'S':
                switchView('settings');
                break;
            case 'ESCAPE':
                if (document.querySelector('.modal-overlay.active')) {
                    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
                }
                break;
        }
    });

    $('#btnExportJson').addEventListener('click', () => {
        const data = {
            transacoes,
            investimentos,
            poupancas,
            recorrentes,
            metas,
            userSettings
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `porquim_backup_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
    });

    $('#btnImportJson').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = JSON.parse(evt.target.result);
                if(data.userSettings) {
                    userSettings = data.userSettings;
                    saveSettings();
                }
                showToast('Importação: settings atualizados. Para restaurar as transações, entre em contato com o suporte.', 'info');
            } catch(err) {
                showToast('Arquivo JSON inválido.', 'error');
            }
        };
        reader.readAsText(file);
    });

    // =========================================
    // RADAR DE MERCADO VIEW
    // =========================================
    let radarNews = [];
    async function refreshRadar() {
        const grid = $('#radarGrid');
        if (!grid) return;
        
        if (radarNews.length === 0) {
            grid.innerHTML = '<div class="empty-state"><p>Buscando notícias...</p></div>';
            try {
                // InfoMoney RSS feed via rss2json
                const data = await fetchWithCache('rss_infomoney', 60 * 60 * 1000, async () => {
                    const res = await fetchWithTimeoutAndRetry('https://api.rss2json.com/v1/api.json?rss_url=https://www.infomoney.com.br/feed/&api_key=', {}, 2, 8000);
                    if (!res.ok) throw new Error('Falha ao carregar notícias');
                    return await res.json();
                });
                
                if (data.status === 'ok') {
                    radarNews = data.items.slice(0, 8); // Top 8 news
                }
            } catch (e) {
                grid.innerHTML = '<div class="empty-state"><p>Erro ao carregar notícias. Tente novamente mais tarde.</p></div>';
                return;
            }
        }
        
        if (radarNews.length > 0) {
            grid.innerHTML = radarNews.map(news => `
                <div class="savings-card" style="cursor: pointer;" onclick="window.open('${news.link}', '_blank')">
                    <div class="savings-card-header" style="flex-direction: column; align-items: flex-start; gap: 8px;">
                        <h4 style="color: var(--white); font-size: 14px; line-height: 1.4; margin: 0;">${escapeHtml(news.title)}</h4>
                        <span style="color: var(--gray); font-size: 11px;">${formatDate(news.pubDate.split(' ')[0])}</span>
                    </div>
                </div>
            `).join('');
        }
    }

    // =========================================
    // REFRESH ALL (UI Only)
    // =========================================
    function refreshAll() {
        const activeView = document.querySelector('.view.active');
        if (activeView) {
            const viewName = activeView.id.replace('view-', '');
            if (viewName === 'dashboard') refreshDashboard();
            if (viewName === 'transacoes') refreshTransacoes();
            if (viewName === 'recorrentes') refreshRecorrentes();
            if (viewName === 'investimentos') refreshInvestimentos();
            if (viewName === 'poupanca') refreshPoupanca();
            if (viewName === 'radar') refreshRadar();
            if (viewName === 'relatorios') refreshRelatorios();
        }
    }

    // =========================================
    // MAGIC INPUT (GEMINI IA)
    // =========================================
    function initMagicInput() {
        const btn = $('#btnMagicSubmit');
        const input = $('#magicInput');
        if (!btn || !input) return;

        btn.addEventListener('click', async () => {
            const text = input.value.trim();
            if (!text) return;
            
            btn.disabled = true;
            btn.textContent = 'Pensando...';

            try {
                const prompt = `Você é um assistente financeiro. 
O usuário digitou: "${text}"
Sua tarefa é extrair as transações financeiras dessa frase e retornar EXATAMENTE UM ARRAY JSON VÁLIDO e NADA MAIS (nenhum markdown, sem crases, apenas o array).
Cada objeto do array deve ter:
- "descricao" (string, nome amigável curto)
- "valor" (number, apenas números positivos)
- "tipo" (string, APENAS "receita" ou "despesa")
- "categoria" (string, tente classificar em: Alimentação, Moradia, Transporte, Saúde, Educação, Lazer, Vestuário, Contas, Assinaturas, Salário, Freelance, Presente, ou "Outros (Despesa)"/"Outros (Receita)")
Seja preciso.`;

                const res = await fetchProxy('gemini', { contents: [{ parts: [{ text: prompt }] }] });

                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`Status ${res.status}: ${errText}`);
                }
                
                const data = await res.json();
                if (!data.candidates || !data.candidates[0].content) {
                    throw new Error('Resposta inesperada da IA: ' + JSON.stringify(data));
                }
                
                let resultText = data.candidates[0].content.parts[0].text;
                // Clean up possible markdown backticks
                resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
                
                let transacoesGeradas;
                try {
                    transacoesGeradas = JSON.parse(resultText);
                } catch (parseError) {
                    throw new Error('A IA não retornou um JSON válido. Retorno: ' + resultText);
                }
                
                for (const t of transacoesGeradas) {
                    await upsertData('transacoes', {
                        id: generateId(),
                        descricao: t.descricao,
                        valor: t.valor,
                        tipo: t.tipo,
                        categoria: t.categoria,
                        data: todayStr(),
                        criado_em: new Date().toISOString()
                    });
                }
                
                input.value = '';
                await loadData();
                refreshAll();
                showToast(`${transacoesGeradas.length} transação(ões) adicionada(s) com sucesso pela IA!`, 'success');
                
            } catch (e) {
                console.error('Erro na IA:', e);
                showToast(`Erro na IA: ${e.message}`, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Enviar';
            }
        });
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') btn.click();
        });
    }





    // =========================================
    // EXPORT FUNCTIONS
    // =========================================
    function initExportDropdown() {
        const toggle = $('#btnExportToggle');
        const dropdown = $('#exportDropdown');
        const btnCSV = $('#btnExportCSV');
        const btnPDF = $('#btnExportPDF');

        if (!toggle || !dropdown) return;

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('show');
        });

        document.addEventListener('click', (e) => {
            if (!toggle.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.remove('show');
            }
        });

        if (btnCSV) {
            btnCSV.addEventListener('click', () => {
                dropdown.classList.remove('show');
                exportToCSV();
            });
        }

        if (btnPDF) {
            btnPDF.addEventListener('click', () => {
                dropdown.classList.remove('show');
                window.print(); // Easy fallback for PDF export
                showToast('Utilize a opção "Salvar como PDF" do seu navegador.', 'success');
            });
        }
    }

    function exportToCSV() {
        if (!transacoes || transacoes.length === 0) {
            showToast('Nenhuma transação para exportar.', 'error');
            return;
        }

        const headers = ['Data', 'Descrição', 'Categoria', 'Tipo', 'Valor'];
        const rows = transacoes.map(t => [
            t.data,
            `"${t.descricao}"`,
            t.categoria,
            t.tipo,
            t.valor
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `porcada_transacoes_${todayStr()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast('Exportado para CSV com sucesso!', 'success');
    }

    // =========================================
    // INIT
    // =========================================
    async function init() {
        await loadData();
        await fetchSelic();
        updateGreeting();
        updateTicker();
        initNav();
        initModals();
        initExportDropdown();
        initConfirm();
        initTransacaoFilters();
        initRelatorioFilters();
        initMagicInput();
        initChatbot();
        initMarketDashboard();
        refreshDashboard();
    }

    let isAppInitialized = false;

    async function handleSession(session) {
        if (session) {
            currentUser = session.user;
            currentToken = session.access_token;
            $('#modalAuth').style.display = 'none';
            if (!isAppInitialized) {
                await init();
                isAppInitialized = true;
            } else {
                await loadData();
                refreshDashboard();
            }
        } else {
            currentUser = null;
            $('#modalAuth').style.display = 'flex';
        }
    }

    function initAuthEvents() {
        $('#formAuth').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = $('#authEmail').value;
            const password = $('#authPassword').value;
            const btn = $('#btnAuthLogin');
            const err = $('#authError');
            
            btn.disabled = true;
            btn.textContent = 'Carregando...';
            err.style.display = 'none';

            const { error } = await sbClient.auth.signInWithPassword({ email, password });
            if (error) {
                err.textContent = error.message;
                err.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Entrar';
            }
        });

        $('#btnAuthSignup').addEventListener('click', async () => {
            const email = $('#authEmail').value;
            const password = $('#authPassword').value;
            const err = $('#authError');
            
            if (!email || !password || password.length < 6) {
                err.textContent = 'Preencha email e senha (mínimo 6 caracteres).';
                err.style.display = 'block';
                return;
            }
            
            const btn = $('#btnAuthSignup');
            btn.disabled = true;
            btn.textContent = 'Criando...';
            err.style.display = 'none';
            
            const { error } = await sbClient.auth.signUp({ email, password });
            if (error) {
                err.textContent = error.message;
                err.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Criar nova conta';
            } else {
                showToast('Conta criada! Você já pode entrar.', 'success');
                btn.disabled = false;
                btn.textContent = 'Criar nova conta';
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        initAuthEvents();
        
        sbClient.auth.getSession().then(({ data: { session } }) => {
            handleSession(session);
        });

        sbClient.auth.onAuthStateChange((_event, session) => {
            handleSession(session);
        });

        // Theme Toggle Logic
        const btnTheme = $('#btnThemeToggle');
        const themeIcon = $('#themeIcon');
        const themeText = $('#themeText');
        
        let isLightMode = localStorage.getItem('porcada_theme') === 'light';
        if (isLightMode) document.body.classList.add('light-mode');
        updateThemeUI();

        if (btnTheme) {
            btnTheme.addEventListener('click', () => {
                isLightMode = !isLightMode;
                document.body.classList.toggle('light-mode', isLightMode);
                localStorage.setItem('porcada_theme', isLightMode ? 'light' : 'dark');
                updateThemeUI();
                refreshAll(); // To redraw charts with new colors
            });
        }

        function updateThemeUI() {
            if (isLightMode) {
                themeIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'; // Moon (to switch back to dark)
                themeText.textContent = 'Dark Mode';
            } else {
                themeIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'; // Sun
                themeText.textContent = 'Light Mode';
            }
        }

        const btnPrivacy = $('#btnPrivacyToggle');
        if (btnPrivacy) {
            btnPrivacy.addEventListener('click', () => {
                isPrivacyMode = !isPrivacyMode;
                document.body.classList.toggle('privacy-mode', isPrivacyMode);
                if (isPrivacyMode) {
                    btnPrivacy.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
                } else {
                    btnPrivacy.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
                }
            });
        }

        // Register Service Worker for PWA
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(registration => {
                        console.log('SW registered with scope:', registration.scope);
                    })
                    .catch(error => {
                        console.error('SW registration failed:', error);
                    });
            });
        }
    });

    // =========================================
    // TOAST NOTIFICATIONS
    // =========================================
    window.showToast = function(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let iconHtml = '';
        if (type === 'success') {
            iconHtml = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--positive)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
        } else if (type === 'error') {
            iconHtml = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--negative)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        }

        toast.innerHTML = `
            ${iconHtml}
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('hiding');
            toast.addEventListener('animationend', () => {
                toast.remove();
            });
        }, 3000);
    };
