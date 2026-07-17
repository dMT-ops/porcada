    // =========================================
    // CHATBOT FINANCEIRO IA
    // =========================================
    let chatHistory = []; // Array of {role, parts} for Gemini multi-turn
    let isChatOpen = false;
    let isBotTyping = false;

    const CHAT_SYSTEM_PROMPT = `Você é a Porcada — a inteligência artificial especialista em gestão financeira do aplicativo de mesmo nome.

Sua persona:
- Especialista financeiro brasileiro, com anos de experiência no mercado.
- Tom profissional mas amigável. Você usa dados concretos e dá insights acionáveis.
- Você é direto, claro, e acessível — evita jargões desnecessários mas explica quando usa termos técnicos.
- Você responde SEMPRE em português brasileiro.

Suas capacidades:
1. ANÁLISE PESSOAL: Analise a situação financeira do usuário com base nos dados fornecidos (saldo, gastos, receitas, investimentos, poupança, metas, recorrentes).
2. ANÁLISE DE MERCADO: Comente sobre tendências do mercado brasileiro (Ibovespa, Selic, CDI, inflação, câmbio), cenário macroeconômico.
3. RECOMENDAÇÕES: Sugira estratégias de investimento adequadas ao perfil do usuário, sempre mencionando riscos.
4. PLANEJAMENTO: Ajude com orçamento, metas de economia, projeções futuras.
5. EDUCAÇÃO: Explique conceitos financeiros (CDI, Selic, Tesouro Direto, CDB, LCI/LCA, renda fixa vs variável, FIIs, diversificação, etc.).
6. COMPARAÇÃO: Compare produtos financeiros quando solicitado.

Regras importantes:
- Você TEM PERMISSÃO para fazer alterações no sistema em nome do usuário usando suas FERRAMENTAS (adicionar transações, metas, recorrentes). Quando o usuário pedir para registrar um gasto, CRIAR algo, acione a ferramenta adequada.
- NUNCA comece suas respostas com "Olá", "Sou a Porcada", "Como especialista..." ou se apresentando novamente. Vá direto ao ponto, aja como se estivesse no meio de uma conversa natural e fluida.
- Seja o mais humano e coloquial possível, sem perder o tom profissional.
- Sempre baseie suas análises pessoais nos DADOS REAIS do usuário fornecidos no contexto.
- Para análise de mercado e moedas (Dólar, Euro, Bitcoin, Selic), use os dados em tempo real fornecidos no contexto. Converta valores automaticamente se o usuário pedir para adicionar um gasto em Dólar.
- Nunca dê conselho específico de compra/venda de ações. Sempre recomende consultar um profissional certificado para decisões grandes.
- Use formatação HTML limpa nas respostas: <strong>, <ul>, <li>, <p>, <h4>. NÃO use markdown (asteriscos, crases). Apenas HTML.
- Seja conciso mas completo. Respostas entre 150-400 palavras idealmente.
- Quando mostrar valores monetários, use o formato R$ X.XXX,XX.`;

    function buildFinancialContext() {
        const today = todayStr();
        const cm = currentMonthStr();

        // Realized transactions (up to today)
        const allRealized = transacoes.filter(t => t.data <= today);
        const allReceitas = allRealized.filter(t => t.tipo === 'receita').reduce((s, t) => s + t.valor, 0);
        const allDespesas = allRealized.filter(t => t.tipo === 'despesa').reduce((s, t) => s + t.valor, 0);
        const saldo = allReceitas - allDespesas;

        // This month
        const mesTrans = transacoes.filter(t => getMonthYear(t.data) === cm);
        const mesReceitas = mesTrans.filter(t => t.tipo === 'receita').reduce((s, t) => s + t.valor, 0);
        const mesDespesas = mesTrans.filter(t => t.tipo === 'despesa').reduce((s, t) => s + t.valor, 0);

        // Category breakdown this month
        const catTotals = {};
        mesTrans.filter(t => t.tipo === 'despesa').forEach(t => {
            catTotals[t.categoria] = (catTotals[t.categoria] || 0) + t.valor;
        });
        const catBreakdown = Object.entries(catTotals)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, val]) => `  - ${cat}: R$ ${val.toFixed(2)}`)
            .join('\n');

        // Top 5 expenses this month
        const topDespesas = mesTrans
            .filter(t => t.tipo === 'despesa')
            .sort((a, b) => b.valor - a.valor)
            .slice(0, 5)
            .map(t => `  - ${t.descricao} (${t.categoria}): R$ ${t.valor.toFixed(2)} em ${formatDate(t.data)}`)
            .join('\n');

        // Savings
        const totalPoupanca = poupancas.reduce((s, p) => s + p.atual, 0);
        const totalMetaPoup = poupancas.reduce((s, p) => s + p.meta, 0);
        const poupDetail = poupancas.map(p => {
            const pct = p.meta > 0 ? Math.round((p.atual / p.meta) * 100) : 0;
            return `  - ${p.nome}: R$ ${p.atual.toFixed(2)} / R$ ${p.meta.toFixed(2)} (${pct}%)`;
        }).join('\n');

        // Investments
        const invAtivos = investimentos.filter(i => i.status === 'ativo');
        const totalInvestido = invAtivos.reduce((s, i) => s + i.valor, 0);
        const invDetail = invAtivos.map(i => {
            return `  - ${i.nome}${i.ticker ? ' (' + i.ticker + ')' : ''} — ${i.tipo}: R$ ${i.valor.toFixed(2)}${i.rendimento ? ' (' + i.rendimento + '% a.a.)' : ''}`;
        }).join('\n');

        // Recorrentes
        const recReceitas = recorrentes.filter(r => r.tipo === 'receita').reduce((s, r) => s + r.valor, 0);
        const recDespesas = recorrentes.filter(r => r.tipo === 'despesa').reduce((s, r) => s + r.valor, 0);
        const recDetail = recorrentes.map(r => {
            return `  - ${r.descricao} (${r.categoria}): R$ ${r.valor.toFixed(2)} — dia ${r.dia} — ${r.tipo}`;
        }).join('\n');

        // Metas de gastos
        const metasDetail = metas.map(m => {
            const gastoCat = mesTrans.filter(t => t.tipo === 'despesa' && t.categoria === m.categoria).reduce((s, t) => s + t.valor, 0);
            const pct = ((gastoCat / m.valor_limite) * 100).toFixed(1);
            return `  - ${m.categoria}: R$ ${gastoCat.toFixed(2)} / R$ ${m.valor_limite.toFixed(2)} (${pct}% utilizado)`;
        }).join('\n');

        const patrimonio = saldo + totalPoupanca + totalInvestido;

        return `
=== DADOS FINANCEIROS DO USUÁRIO (${formatDate(today)}) ===

SALDO ATUAL (receitas - despesas realizadas): R$ ${saldo.toFixed(2)}
PATRIMÔNIO TOTAL (saldo + poupança + investimentos): R$ ${patrimonio.toFixed(2)}
TAXA SELIC ATUAL: ${selicRate}% a.a.
COTAÇÕES DE HOJE (Tempo Real): Dólar (USD) = R$ ${globalUsd} | Euro (EUR) = R$ ${globalEur} | Bitcoin (BTC) = R$ ${globalBtc}

MÊS ATUAL (${cm}):
- Receitas: R$ ${mesReceitas.toFixed(2)}
- Despesas: R$ ${mesDespesas.toFixed(2)}
- Balanço: R$ ${(mesReceitas - mesDespesas).toFixed(2)}

DESPESAS POR CATEGORIA (mês):
${catBreakdown || '  (nenhuma despesa este mês)'}

TOP 5 MAIORES GASTOS (mês):
${topDespesas || '  (nenhum gasto este mês)'}

POUPANÇA / RESERVAS (total guardado: R$ ${totalPoupanca.toFixed(2)} / meta: R$ ${totalMetaPoup.toFixed(2)}):
${poupDetail || '  (nenhuma reserva cadastrada)'}

INVESTIMENTOS (total investido ativo: R$ ${totalInvestido.toFixed(2)}, ${invAtivos.length} ativo(s)):
${invDetail || '  (nenhum investimento ativo)'}

RECORRENTES FIXAS (receitas fixas: R$ ${recReceitas.toFixed(2)} / despesas fixas: R$ ${recDespesas.toFixed(2)}):
${recDetail || '  (nenhuma recorrente cadastrada)'}

METAS DE GASTOS (budget por categoria):
${metasDetail || '  (nenhuma meta configurada)'}
=== FIM DOS DADOS ===`;
    }

    function addChatMessage(role, content) {
        const messagesEl = $('#chatMessages');
        const div = document.createElement('div');
        div.className = `chat-msg ${role}`;

        const avatarIcon = role === 'bot'
            ? svgIcon(SVG_PATHS.box, 14)
            : '👤';

        div.innerHTML = `
            <div class="chat-msg-avatar">${avatarIcon}</div>
            <div class="chat-msg-bubble">${content}</div>
        `;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTypingIndicator() {
        const messagesEl = $('#chatMessages');
        const div = document.createElement('div');
        div.className = 'chat-typing';
        div.id = 'chatTyping';
        div.innerHTML = `
            <div class="chat-msg-avatar">${svgIcon(SVG_PATHS.box, 14)}</div>
            <div class="chat-typing-dots">
                <span></span><span></span><span></span>
            </div>
        `;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function hideTypingIndicator() {
        const el = $('#chatTyping');
        if (el) el.remove();
    }

    function showWelcomeMessage() {
        const messagesEl = $('#chatMessages');
        messagesEl.innerHTML = `
            <div class="chat-welcome">
                <div class="chat-welcome-icon">
                    ${svgIcon(SVG_PATHS.box, 22)}
                </div>
                <h4>Porcada</h4>
                <p>Olá! Sou a Porcada, sua especialista financeira pessoal. Posso analisar seus gastos, dar dicas de investimento, explicar conceitos financeiros e muito mais. Como posso ajudar?</p>
            </div>
        `;
    }

    async function sendChatMessage(text) {
        if (!text.trim() || isBotTyping) return;

        // Remove welcome message on first interaction
        const welcomeEl = document.querySelector('.chat-welcome');
        if (welcomeEl) welcomeEl.remove();

        // Add user message to UI
        addChatMessage('user', escapeHtml(text));

        // Hide chips after first message
        const chipsEl = $('#chatChips');
        if (chipsEl) chipsEl.style.display = 'none';

        // Clear input
        $('#chatInput').value = '';

        // Build context on first message or refresh it periodically
        const financialContext = buildFinancialContext();

        // Add to chat history for Gemini
        if (chatHistory.length === 0) {
            chatHistory.push({
                role: 'user',
                parts: [{ text: CHAT_SYSTEM_PROMPT + '\n\n' + financialContext + '\n\nMinha pergunta: ' + text }]
            });
        } else {
            chatHistory.push({
                role: 'user',
                parts: [{ text: financialContext + '\n\nMinha pergunta: ' + text }]
            });
        }

        isBotTyping = true;
        $('#chatSend').disabled = true;
        $('#chatStatus').textContent = 'Analisando...';
        showTypingIndicator();

        try {
            let currentLoop = 0;
            let finalBotText = '';

            const functionDeclarations = [
                {
                    name: "adicionarTransacao",
                    description: "Adiciona uma transação financeira (receita ou despesa)",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            descricao: { type: "STRING" },
                            valor: { type: "NUMBER" },
                            tipo: { type: "STRING", enum: ["receita", "despesa"] },
                            categoria: { type: "STRING" },
                            data: { type: "STRING", description: "YYYY-MM-DD" }
                        },
                        required: ["descricao", "valor", "tipo", "categoria", "data"]
                    }
                },
                {
                    name: "adicionarMeta",
                    description: "Adiciona uma meta de limite de gastos para uma categoria",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            categoria: { type: "STRING", description: "Nome da categoria (ex: Alimentação, Lazer)" },
                            valor_limite: { type: "NUMBER", description: "Valor máximo que deseja gastar na categoria" }
                        },
                        required: ["categoria", "valor_limite"]
                    }
                },
                {
                    name: "adicionarRecorrente",
                    description: "Adiciona uma despesa ou receita recorrente mensal",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            descricao: { type: "STRING" },
                            valor: { type: "NUMBER" },
                            tipo: { type: "STRING", enum: ["receita", "despesa"] },
                            categoria: { type: "STRING" },
                            dia: { type: "NUMBER", description: "Dia do mês (1 a 31)" }
                        },
                        required: ["descricao", "valor", "tipo", "categoria", "dia"]
                    }
                }
            ];

            while (currentLoop < 3) {
                currentLoop++;

                const payload = {
                    contents: chatHistory,
                    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
                    tools: [
                        { functionDeclarations: functionDeclarations }
                    ]
                };

                let res = await fetchProxy('gemini', payload);

                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`Status ${res.status}: ${errText}`);
                }

                const data = await res.json();
                const parts = data.candidates?.[0]?.content?.parts || [];

                let hasFunctionCall = false;
                let functionResponses = [];
                let botText = '';

                for (const part of parts) {
                    if (part.text) botText += part.text;
                    if (part.functionCall) {
                        hasFunctionCall = true;
                        const call = part.functionCall;
                        const args = call.args;
                        let resultStr = "Sucesso";

                        try {
                            if (call.name === 'adicionarTransacao') {
                                await upsertData('transacoes', {
                                    descricao: args.descricao,
                                    valor: parseFloat(args.valor),
                                    tipo: args.tipo,
                                    categoria: args.categoria,
                                    data: args.data
                                });
                            } else if (call.name === 'adicionarMeta') {
                                await upsertData('metas', {
                                    categoria: args.categoria,
                                    valor_limite: parseFloat(args.valor_limite)
                                });
                            } else if (call.name === 'adicionarRecorrente') {
                                await upsertData('recorrentes', {
                                    descricao: args.descricao,
                                    valor: parseFloat(args.valor),
                                    tipo: args.tipo,
                                    categoria: args.categoria,
                                    dia: parseInt(args.dia)
                                });
                            } else {
                                resultStr = "Função não suportada";
                            }
                        } catch (e) {
                            resultStr = "Erro no banco de dados: " + e.message;
                            console.error(e);
                        }

                        functionResponses.push({
                            functionResponse: {
                                name: call.name,
                                response: { name: call.name, content: { result: resultStr } }
                            }
                        });
                    }
                }

                if (hasFunctionCall) {
                    // Record model's function calls
                    chatHistory.push({ role: 'model', parts: parts });
                    
                    // Record our responses
                    chatHistory.push({ role: 'user', parts: functionResponses });
                    
                    // Refresh data behind the scenes
                    await loadData();
                    refreshAll();
                    
                    $('#chatStatus').textContent = 'Aplicando mudanças...';
                } else {
                    finalBotText = botText;
                    chatHistory.push({ role: 'model', parts: [{ text: botText }] });
                    break;
                }
            }

            // Clean up markdown artifacts
            finalBotText = finalBotText.replace(/```html/g, '').replace(/```/g, '').trim();
            finalBotText = finalBotText.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            finalBotText = finalBotText.replace(/^- (.+)$/gm, '<li>$1</li>');
            finalBotText = finalBotText.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

            if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

            hideTypingIndicator();
            if (finalBotText) addChatMessage('bot', finalBotText);

        } catch (e) {
            console.error('Chatbot error:', e);
            hideTypingIndicator();
            addChatMessage('bot', `<p style="color:var(--negative)">Desculpe, ocorreu um erro: ${escapeHtml(e.message)}</p>`);
        } finally {
            isBotTyping = false;
            $('#chatSend').disabled = false;
            $('#chatStatus').textContent = 'Online';
        }
    }

    function toggleChat() {
        isChatOpen = !isChatOpen;
        const panel = $('#chatPanel');
        const fab = $('#chatFab');

        if (isChatOpen) {
            panel.classList.add('open');
            fab.classList.add('active');
            $('#chatInput').focus();

            // Show welcome on first open
            if ($('#chatMessages').children.length === 0) {
                showWelcomeMessage();
            }
        } else {
            panel.classList.remove('open');
            fab.classList.remove('active');
        }
    }

    function initChatbot() {
        const fab = $('#chatFab');
        const closeBtn = $('#chatClose');
        const sendBtn = $('#chatSend');
        const input = $('#chatInput');

        if (!fab) return;

        fab.addEventListener('click', toggleChat);
        closeBtn.addEventListener('click', toggleChat);

        // Send message
        sendBtn.addEventListener('click', () => {
            sendChatMessage(input.value);
        });

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage(input.value);
            }
        });

        // Quick reply chips
        $$('.chat-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const prompt = chip.dataset.prompt;
                if (prompt) {
                    sendChatMessage(prompt);
                }
            });
        });
    }
