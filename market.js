    // =========================================
    // MARKET DASHBOARD (BRAPI + CHART.JS)
    // =========================================
    let marketChartInstance = null;

    function initMarketDashboard() {
        const filters = document.querySelectorAll('.market-filter');
        filters.forEach(btn => {
            btn.addEventListener('click', (e) => {
                filters.forEach(f => f.classList.remove('active'));
                e.target.classList.add('active');
                loadMarketDashboard(e.target.dataset.range);
            });
        });
    }

    async function loadMarketDashboard(range = '1d') {
        const priceEl = $('#marketPrice');
        const changeEl = $('#marketChange');
        const listEl = $('#marketList');
        const ctx = document.getElementById('marketChart');
        if (!ctx) return;

        // Determinar intervalo com base no range
        let interval = '5m';
        if (range === '5d') interval = '15m';
        else if (range === '1mo') interval = '1d';
        else if (range === '1y') interval = '1d';

        // 1. Fetch Ibovespa historical data
        try {
            const data = await fetchWithCache(`brapi_chart_${range}_${interval}`, 5 * 60 * 1000, async () => {
                const res = await fetchProxy('brapi-chart', { ticker: '^BVSP', range, interval });
                if (!res.ok) throw new Error('Falha Brapi Chart');
                return await res.json();
            });
            
            if (data.results && data.results[0] && data.results[0].historicalDataPrice) {
                const history = data.results[0].historicalDataPrice;
                const prices = history.map(h => h.close).filter(p => p != null);
                const labels = history.map(h => {
                    const d = new Date(h.date * 1000);
                    return range === '1d' || range === '5d' ? 
                        `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}` : 
                        `${d.getDate()}/${d.getMonth()+1}`;
                }).filter((_, i) => history[i].close != null);

                const currentPrice = data.results[0].regularMarketPrice;
                const previousClose = data.results[0].regularMarketPreviousClose;
                const changePercent = data.results[0].regularMarketChangePercent;
                const changePoints = currentPrice - previousClose;

                // Update Headers
                priceEl.textContent = currentPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
                const isPositive = changePercent >= 0;
                changeEl.textContent = `${isPositive ? '+' : ''}${changePoints.toLocaleString('pt-BR', {minimumFractionDigits: 2})} (${isPositive ? '+' : ''}${changePercent.toFixed(2)}%)`;
                changeEl.className = isPositive ? 'positive' : 'negative';

                // Render Chart
                if (marketChartInstance) marketChartInstance.destroy();
                
                const chartColor = isPositive ? '#10b981' : '#ef4444';
                
                // Create Gradient
                const canvasCtx = ctx.getContext('2d');
                const gradient = canvasCtx.createLinearGradient(0, 0, 0, 400);
                gradient.addColorStop(0, isPositive ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)');
                gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

                marketChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'IBOVESPA',
                            data: prices,
                            borderColor: chartColor,
                            backgroundColor: gradient,
                            borderWidth: 2,
                            fill: true,
                            tension: 0.1,
                            pointRadius: 0,
                            pointHoverRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: {
                            x: { display: false },
                            y: {
                                position: 'right',
                                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                                ticks: { color: 'var(--text-muted)' }
                            }
                        },
                        interaction: { mode: 'index', intersect: false }
                    }
                });
            }
        } catch (e) {
            console.error("Erro ao renderizar gráfico", e);
        }

        // 2. Fetch Top Stocks (Simulation with predefined popular tickers)
        try {
            const tickers = ['PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'B3SA3', 'WEGE3', 'ABEV3', 'BBAS3'];
            const data = await fetchWithCache('brapi_top_stocks', 5 * 60 * 1000, async () => {
                const res = await fetchProxy('brapi-quote', { tickers });
                if (!res.ok) throw new Error('Falha Brapi Top');
                return await res.json();
            });
            
            if (data.results) {
                // Sort by variation
                const sorted = data.results.sort((a, b) => b.regularMarketChangePercent - a.regularMarketChangePercent);
                
                listEl.innerHTML = sorted.map(stock => {
                    const isPos = stock.regularMarketChangePercent >= 0;
                    return `
                    <div class="market-item">
                        <div class="market-item-info">
                            <div class="market-item-icon" style="background: ${isPos ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}">
                                ${stock.symbol.substring(0,1)}
                            </div>
                            <div>
                                <div class="market-item-ticker">${stock.symbol}</div>
                                <div class="market-item-name">${stock.shortName || stock.symbol}</div>
                            </div>
                        </div>
                        <div class="market-item-stats">
                            <div class="market-item-price">${stock.regularMarketPrice.toFixed(2)}</div>
                            <div class="market-item-change ${isPos ? 'positive' : 'negative'}">
                                ${isPos ? '+' : ''}${stock.regularMarketChangePercent.toFixed(2)}%
                            </div>
                        </div>
                    </div>
                    `;
                }).join('');
            }
        } catch (e) {
            console.error("Erro ao buscar top stocks", e);
        }
    }
