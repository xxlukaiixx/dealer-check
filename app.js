// State Management
const state = {
    currentView: 'user', // 'user' or 'admin'
    isAdmin: false,
    config: {
        densityRule: 5000, // 1 dealer per 5000 inhabitants
        occupiedCities: [], // Array of objects: { city, uf, dealers, lat, lon }
        warningDays: 30 // Keep for future use if needed
    },
    selectedLocation: null, // { city, uf, ibgeId, population }
    allCities: [], // Cache for IBGE cities list
    mapChart: null // Highcharts instance
};

// DOM Elements
const elements = {
    views: {
        user: document.getElementById('user-view'),
        admin: document.getElementById('admin-view')
    },
    inputs: {
        search: document.getElementById('search-input'), // Unified Search
        adminPass: document.getElementById('admin-pass'),
        density: document.getElementById('density-rule'),
        occupiedCity: document.getElementById('occupied-city-input'),
        occupiedUf: document.getElementById('occupied-uf-input'),
        occupiedDealers: document.getElementById('occupied-dealers-input')
    },
    buttons: {
        search: document.getElementById('search-btn'),
        adminToggle: document.getElementById('admin-toggle'),
        login: document.getElementById('login-btn'),
        logout: document.getElementById('logout-btn'),
        saveDensity: document.getElementById('save-density'),
        addOccupied: document.getElementById('add-occupied-btn'),
        closeTutorial: document.getElementById('close-tutorial')
    },
    containers: {
        result: document.getElementById('result-container'),
        loginPanel: document.getElementById('login-panel'),
        adminPanel: document.getElementById('admin-panel'),
        occupiedList: document.getElementById('occupied-list'),
        tutorialModal: document.getElementById('tutorial-modal')
    }
};

// --- Initialization ---
async function init() {
    loadConfig();
    checkTutorial();
    populateUfSelect();
    setupEventListeners();
    initMap(); // Initialize Map
    await loadAllCities(); // Pre-load cities for name search
}

// --- Map Logic ---
function initMap() {
    const data = getMapData();

    state.mapChart = Highcharts.mapChart('map-container', {
        chart: {
            map: 'countries/br/br-all',
            backgroundColor: 'transparent',
            style: {
                fontFamily: 'Montserrat'
            },
            margin: 0
        },
        title: { text: '' },
        mapNavigation: {
            enabled: false // Zoom disabled as requested
        },
        colorAxis: {
            min: 0,
            minColor: '#2c2c2c', // Dark Grey
            maxColor: '#f0f0f0', // White
            labels: { style: { color: '#888' } }
        },
        plotOptions: {
            map: {
                allAreas: true,
                borderColor: '#444',
                borderWidth: 1,
                states: {
                    hover: {
                        color: '#fff',
                        borderColor: '#000'
                    }
                }
            }
        },
        series: [{
            data: data,
            name: 'Revendedores por Estado',
            dataLabels: {
                enabled: true,
                format: '{point.name}',
                style: {
                    color: '#888',
                    textOutline: 'none',
                    fontWeight: 'normal',
                    fontSize: '10px'
                }
            },
            tooltip: {
                pointFormat: '{point.name}: {point.value} Revendedores',
                headerFormat: ''
            }
        }, {
            // City Markers Series (Bubbles)
            type: 'mappoint',
            name: 'Cidades em Destaque',
            color: '#000', // Black dots
            data: [], // Populated dynamically
            marker: {
                lineWidth: 1,
                lineColor: '#fff',
                fillColor: '#000',
                symbol: 'circle',
                radius: 6
            },
            dataLabels: {
                enabled: true,
                format: '{point.name}',
                style: {
                    color: '#000',
                    textOutline: '2px contrast'
                },
                y: -10
            },
            tooltip: {
                pointFormat: '<b>{point.name}</b><br>{point.dealers} Revendedores'
            }
        }]
    });

    // Initial load of city markers
    updateMapMarkers();
}

async function updateMapMarkers() {
    if (!state.mapChart) return;

    const markers = [];

    for (const item of state.config.occupiedCities) {
        try {
            if (!item.lat || !item.lon) {
                const query = `${item.city}, ${item.uf}, Brazil`;
                const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
                const data = await response.json();
                if (data && data.length > 0) {
                    item.lat = parseFloat(data[0].lat);
                    item.lon = parseFloat(data[0].lon);
                }
            }

            if (item.lat && item.lon) {
                markers.push({
                    name: item.city,
                    lat: item.lat,
                    lon: item.lon,
                    dealers: parseInt(item.dealers),
                    z: parseInt(item.dealers)
                });
            }
        } catch (e) {
            console.error(`Erro ao buscar coords para ${item.city}`, e);
        }
    }

    if (state.mapChart.series[1]) {
        state.mapChart.series[1].setData(markers);
    }
}

function getMapData() {
    const counts = {};
    state.config.occupiedCities.forEach(item => {
        const uf = item.uf.toLowerCase();
        const key = `br-${uf}`;
        const dealers = parseInt(item.dealers) || 0;
        if (!counts[key]) counts[key] = 0;
        counts[key] += dealers;
    });

    const allKeys = [
        'br-ac', 'br-al', 'br-ap', 'br-am', 'br-ba', 'br-ce', 'br-df', 'br-es', 'br-go', 'br-ma',
        'br-mt', 'br-ms', 'br-mg', 'br-pa', 'br-pb', 'br-pr', 'br-pe', 'br-pi', 'br-rj', 'br-rn',
        'br-rs', 'br-ro', 'br-rr', 'br-sc', 'br-sp', 'br-se', 'br-to'
    ];

    return allKeys.map(key => ({
        'hc-key': key,
        value: counts[key] || 0
    }));
}

function updateMapData() {
    if (state.mapChart) {
        const newData = getMapData();
        state.mapChart.series[0].setData(newData);
        updateMapMarkers();
    }
}

// --- Data Loading with Local Fallback ---
async function loadAllCities() {
    // 1. Try Local JSON (Most Reliable)
    try {
        console.log("Tentando carregar base local (cities.json)...");
        const response = await fetch('cities.json');
        if (!response.ok) throw new Error('Local JSON not found');

        const data = await response.json();
        state.allCities = data.map(city => ({
            name: city.nome,
            uf: city.microrregiao.mesorregiao.UF.sigla,
            id: city.id
        }));

        console.log(`Sucesso Local: ${state.allCities.length} cidades carregadas.`);
        showToast(`Base de dados completa carregada.`, 'success');
        return;
    } catch (localError) {
        console.warn('Erro ao carregar local, tentando API...', localError);
    }

    // 2. Try API (Backup)
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            console.log(`Tentativa API ${attempt + 1}/${maxRetries}...`);
            const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios');
            if (!response.ok) throw new Error('IBGE API Error');

            const data = await response.json();
            state.allCities = data.map(city => ({
                name: city.nome,
                uf: city.microrregiao.mesorregiao.UF.sigla,
                id: city.id
            }));

            console.log(`Sucesso API: ${state.allCities.length} cidades carregadas.`);
            showToast(`Base de dados carregada via API.`, 'success');
            return;
        } catch (error) {
            console.error(`Erro API tentativa ${attempt + 1}:`, error);
            attempt++;
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // 3. Hardcoded Fallback (Last Resort)
    console.error('Todas as tentativas falharam. Usando fallback crítico.');
    useFallbackCities();
}

function useFallbackCities() {
    const fallbackCities = [
        { name: "São Paulo", uf: "SP", id: 3550308 },
        { name: "Rio de Janeiro", uf: "RJ", id: 3304557 },
        { name: "Brasília", uf: "DF", id: 5300108 },
        { name: "Salvador", uf: "BA", id: 2927408 },
        { name: "Fortaleza", uf: "CE", id: 2304400 },
        { name: "Belo Horizonte", uf: "MG", id: 3106200 },
        { name: "Manaus", uf: "AM", id: 1302603 },
        { name: "Curitiba", uf: "PR", id: 4106902 },
        { name: "Recife", uf: "PE", id: 2611606 },
        { name: "Goiânia", uf: "GO", id: 5208707 },
        { name: "Belém", uf: "PA", id: 1501402 },
        { name: "Porto Alegre", uf: "RS", id: 4314902 },
        { name: "Guarulhos", uf: "SP", id: 3518800 },
        { name: "Campinas", uf: "SP", id: 3509502 },
        { name: "São Luís", uf: "MA", id: 2111300 },
        { name: "São Gonçalo", uf: "RJ", id: 3304904 },
        { name: "Maceió", uf: "AL", id: 2704302 },
        { name: "Duque de Caxias", uf: "RJ", id: 3301702 },
        { name: "Campo Grande", uf: "MS", id: 5002704 },
        { name: "Natal", uf: "RN", id: 2408102 },
        { name: "Teresina", uf: "PI", id: 2211001 },
        { name: "São Bernardo do Campo", uf: "SP", id: 3548708 },
        { name: "João Pessoa", uf: "PB", id: 2507507 },
        { name: "Nova Iguaçu", uf: "RJ", id: 3303500 },
        { name: "Santo André", uf: "SP", id: 3547809 },
        { name: "Osasco", uf: "SP", id: 3534401 },
        { name: "São José dos Campos", uf: "SP", id: 3549904 },
        { name: "Jaboatão dos Guararapes", uf: "PE", id: 2607901 },
        { name: "Ribeirão Preto", uf: "SP", id: 3543402 },
        { name: "Uberlândia", uf: "MG", id: 3170206 },
        { name: "Sorocaba", uf: "SP", id: 3552205 },
        { name: "Contagem", uf: "MG", id: 3118601 },
        { name: "Aracaju", uf: "SE", id: 2800308 },
        { name: "Feira de Santana", uf: "BA", id: 2910800 },
        { name: "Cuiabá", uf: "MT", id: 5103403 },
        { name: "Joinville", uf: "SC", id: 4209102 },
        { name: "Florianópolis", uf: "SC", id: 4205407 },
        { name: "Londrina", uf: "PR", id: 4113700 },
        { name: "Juiz de Fora", uf: "MG", id: 3136702 },
        { name: "Niterói", uf: "RJ", id: 3303302 }
    ];

    state.allCities = fallbackCities;
    showToast('Modo Offline: Carregadas principais cidades.', 'warning');
}

// --- Tutorial ---
function checkTutorial() {
    const hasSeen = localStorage.getItem('dealerCheckTutorialV2');
    if (!hasSeen) {
        elements.containers.tutorialModal.classList.remove('hidden');
    }
}

function closeTutorial() {
    elements.containers.tutorialModal.classList.add('hidden');
    localStorage.setItem('dealerCheckTutorialV2', 'true');
}

// --- Search Logic (Autocomplete) ---
function handleSearchInput(e) {
    const val = this.value;
    const list = document.getElementById('autocomplete-list');
    list.innerHTML = '';

    if (!val || val.length < 2) {
        list.classList.add('hidden');
        return;
    }

    // Check if it's a CEP (digits only)
    if (/^\d+$/.test(val)) {
        list.classList.add('hidden');
        return; // Let the button handle CEP search
    }

    const normalizedQuery = val.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // Filter cities (limit to 10 suggestions for performance)
    const matches = state.allCities.filter(city => {
        const normalizedCity = city.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return normalizedCity.startsWith(normalizedQuery);
    }).slice(0, 8);

    if (matches.length > 0) {
        list.classList.remove('hidden');
        matches.forEach(city => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.innerHTML = `<strong>${city.name.substr(0, val.length)}</strong>${city.name.substr(val.length)} - ${city.uf}`;
            item.addEventListener('click', () => {
                elements.inputs.search.value = `${city.name} - ${city.uf}`; // Fill input
                list.classList.add('hidden');
                processLocationSelection(city.name, city.uf, city.id); // Trigger search
            });
            list.appendChild(item);
        });
    } else {
        list.classList.add('hidden');
    }
}

async function handleSearch() {
    const query = elements.inputs.search.value.trim();
    if (!query) return;

    const cleanQuery = query.replace(/\D/g, '');
    if (cleanQuery.length === 8) {
        await searchByCep(cleanQuery);
    } else {
        // Fallback for manual enter without selecting from list
        const parts = query.split('-');
        const namePart = parts[0].trim();
        searchByName(namePart);
    }
}

async function searchByCep(cep) {
    try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await response.json();

        if (data.erro) {
            showToast('CEP não encontrado.', 'error');
            return;
        }

        await processLocationSelection(data.localidade, data.uf, data.ibge);
    } catch (error) {
        showToast('Erro ao buscar CEP.', 'error');
    }
}

function searchByName(name) {
    if (!state.allCities || state.allCities.length === 0) {
        showToast('Aguarde, carregando cidades...', 'warning');
        return;
    }

    const normalizedQuery = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const matches = state.allCities.filter(city => {
        const normalizedCity = city.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return normalizedCity.includes(normalizedQuery);
    }).slice(0, 10);

    if (matches.length === 0) {
        showToast('Cidade não encontrada.', 'warning');
        return;
    }

    if (matches.length === 1) {
        processLocationSelection(matches[0].name, matches[0].uf, matches[0].id);
    } else {
        // If multiple matches but user pressed enter, pick first
        processLocationSelection(matches[0].name, matches[0].uf, matches[0].id);
    }
}

async function processLocationSelection(city, uf, ibgeId) {
    const population = await getCityPopulation(ibgeId);
    state.selectedLocation = { city, uf, ibgeId, population };
    checkAvailability();

    // Map Highlight
    if (state.mapChart) {
        const key = `br-${uf.toLowerCase()}`;
        const point = state.mapChart.series[0].points.find(p => p['hc-key'] === key);
        if (point) {
            // point.zoomTo(); // Disabled zoom
            point.select(true, false);
        }
    }
}

async function getCityPopulation(ibgeId) {
    try {
        const response = await fetch(`https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[${ibgeId}]`);
        const data = await response.json();
        const serie = data[0]?.resultados[0]?.series[0]?.serie;
        if (serie) return parseInt(Object.values(serie)[0]);
        return 50000; // Fallback
    } catch (error) {
        console.error('Erro IBGE:', error);
        return 50000;
    }
}

// --- Business Logic ---
function checkAvailability() {
    const { city, uf, population } = state.selectedLocation;

    const occupiedData = state.config.occupiedCities.find(
        item => item.city === city && item.uf === uf
    );

    const currentDealers = occupiedData ? parseInt(occupiedData.dealers) : 0;
    const maxDealers = Math.floor(population / state.config.densityRule);
    const isAvailable = currentDealers < maxDealers;

    showResult(isAvailable, city, uf, population, currentDealers, maxDealers);
}

// --- UI Functions ---
function showResult(isAvailable, city, uf, population, currentDealers, maxDealers) {
    const container = elements.containers.result;
    container.classList.remove('hidden');

    let html = '';
    const popFormatted = population.toLocaleString('pt-BR');

    if (isAvailable) {
        html = `
            <div class="glass-card result-card status-available-card">
                <div class="status-icon"><i class="fa-solid fa-check"></i></div>
                <h2 class="result-title">DISPONÍVEL</h2>
                <p class="result-city">${city} - ${uf}</p>
                <p class="result-pop"><i class="fa-solid fa-users"></i> População: ${popFormatted}</p>
                <div id="saturation-gauge" style="height: 200px; margin: 1rem 0;"></div>
                <p class="result-desc">Esta praça está aberta para novos parceiros.</p>
                <!-- Button removed as per request -->
            </div>
        `;
    } else {
        html = `
            <div class="glass-card result-card status-unavailable-card">
                <div class="status-icon"><i class="fa-solid fa-xmark"></i></div>
                <h2 class="result-title">INDISPONÍVEL</h2>
                <p class="result-city">${city} - ${uf}</p>
                <p class="result-pop"><i class="fa-solid fa-users"></i> População: ${popFormatted}</p>
                <div id="saturation-gauge" style="height: 200px; margin: 1rem 0;"></div>
                <p class="result-desc">Esta praça já atingiu o limite de parceiros.</p>
            </div>
        `;
    }

    container.innerHTML = html;
    renderGaugeChart(currentDealers, maxDealers);
}

function renderGaugeChart(current, max) {
    Highcharts.chart('saturation-gauge', {
        chart: { type: 'solidgauge', backgroundColor: 'transparent' },
        title: { text: 'Saturação da Praça', style: { color: '#fff', fontSize: '14px' } },
        pane: {
            center: ['50%', '85%'],
            size: '100%',
            startAngle: -90,
            endAngle: 90,
            background: { backgroundColor: '#333', innerRadius: '60%', outerRadius: '100%', shape: 'arc' }
        },
        yAxis: {
            min: 0,
            max: max,
            stops: [[0.1, '#55BF3B'], [0.5, '#DDDF0D'], [0.9, '#DF5353']],
            lineWidth: 0,
            tickWidth: 0,
            minorTickInterval: null,
            tickAmount: 2,
            title: { y: -70 },
            labels: { y: 16, style: { color: '#fff' } }
        },
        plotOptions: { solidgauge: { dataLabels: { y: 5, borderWidth: 0, useHTML: true } } },
        series: [{
            name: 'Revendedores',
            data: [current],
            dataLabels: {
                format: '<div style="text-align:center"><span style="font-size:25px;color:#fff">{y}</span><br/>' +
                    '<span style="font-size:12px;color:#888">de ' + max + '</span></div>'
            }
        }],
        credits: { enabled: false }
    });
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function populateUfSelect() {
    const ufs = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
    const select = elements.inputs.occupiedUf;
    ufs.forEach(uf => {
        const option = document.createElement('option');
        option.value = uf;
        option.textContent = uf;
        select.appendChild(option);
    });
}

// --- Admin & Config ---
function loadConfig() {
    const saved = localStorage.getItem('dealerCheckConfigV2');
    if (saved) {
        state.config = JSON.parse(saved);
        elements.inputs.density.value = state.config.densityRule;
        renderOccupiedList();
    }
}

function saveConfig() {
    localStorage.setItem('dealerCheckConfigV2', JSON.stringify(state.config));
    showToast('Configurações salvas!', 'success');
    updateMapData();
    renderAdminChart();
}

function renderAdminChart() {
    const counts = {};
    state.config.occupiedCities.forEach(item => {
        if (!counts[item.uf]) counts[item.uf] = 0;
        counts[item.uf] += parseInt(item.dealers);
    });

    const chartData = Object.keys(counts).map(uf => ({ name: uf, y: counts[uf] }));

    Highcharts.chart('admin-chart-container', {
        chart: { type: 'pie', backgroundColor: 'transparent' },
        title: { text: '' },
        plotOptions: {
            pie: {
                innerSize: '50%',
                dataLabels: { enabled: true, format: '<b>{point.name}</b>: {point.y}', style: { color: '#ccc' } }
            }
        },
        series: [{ name: 'Revendedores', data: chartData }],
        credits: { enabled: false }
    });
}

function renderOccupiedList() {
    const list = elements.containers.occupiedList;
    list.innerHTML = '';

    state.config.occupiedCities.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'occupied-item';
        li.innerHTML = `
            <div class="occupied-info">
                <strong>${item.city} - ${item.uf}</strong>
                <span>${item.dealers} Revendedores</span>
            </div>
            <button onclick="removeOccupied(${index})" class="remove-btn"><i class="fa-solid fa-trash"></i></button>
        `;
        list.appendChild(li);
    });
}

window.removeOccupied = function (index) {
    state.config.occupiedCities.splice(index, 1);
    saveConfig();
    renderOccupiedList();
};

// --- Event Listeners ---
function setupEventListeners() {
    elements.buttons.closeTutorial.addEventListener('click', closeTutorial);

    elements.buttons.search.addEventListener('click', handleSearch);
    elements.inputs.search.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // Autocomplete Listeners
    elements.inputs.search.addEventListener('input', handleSearchInput);

    document.addEventListener('click', (e) => {
        if (e.target !== elements.inputs.search) {
            const list = document.getElementById('autocomplete-list');
            if (list) list.classList.add('hidden');
        }
    });

    elements.buttons.adminToggle.addEventListener('click', () => {
        state.currentView = state.currentView === 'user' ? 'admin' : 'user';
        toggleView();
        if (state.currentView === 'admin' && state.isAdmin) {
            setTimeout(renderAdminChart, 300);
        }
    });

    elements.buttons.login.addEventListener('click', () => {
        if (elements.inputs.adminPass.value === 'admin123') {
            state.isAdmin = true;
            elements.containers.loginPanel.classList.add('hidden');
            elements.containers.adminPanel.classList.remove('hidden');
            renderAdminChart();
        } else {
            showToast('Senha incorreta', 'error');
        }
    });

    elements.buttons.logout.addEventListener('click', () => {
        state.isAdmin = false;
        elements.containers.loginPanel.classList.remove('hidden');
        elements.containers.adminPanel.classList.add('hidden');
        elements.inputs.adminPass.value = '';
    });

    elements.buttons.saveDensity.addEventListener('click', () => {
        state.config.densityRule = parseInt(elements.inputs.density.value);
        saveConfig();
    });

    elements.buttons.addOccupied.addEventListener('click', () => {
        const city = elements.inputs.occupiedCity.value;
        const uf = elements.inputs.occupiedUf.value;
        const dealers = elements.inputs.occupiedDealers.value;

        if (city && uf && dealers) {
            const existingIndex = state.config.occupiedCities.findIndex(i => i.city === city && i.uf === uf);
            if (existingIndex >= 0) {
                state.config.occupiedCities[existingIndex].dealers = dealers;
            } else {
                state.config.occupiedCities.push({ city, uf, dealers });
            }
            saveConfig();
            renderOccupiedList();
            elements.inputs.occupiedCity.value = '';
            elements.inputs.occupiedUf.value = '';
            elements.inputs.occupiedDealers.value = '';
        } else {
            showToast('Preencha todos os campos', 'error');
        }
    });
}

function toggleView() {
    if (state.currentView === 'user') {
        elements.views.user.classList.remove('hidden');
        elements.views.user.classList.add('active');
        elements.views.admin.classList.add('hidden');
        elements.views.admin.classList.remove('active');
    } else {
        elements.views.user.classList.add('hidden');
        elements.views.user.classList.remove('active');
        elements.views.admin.classList.remove('hidden');
        elements.views.admin.classList.add('active');
    }
}

// Start
init();
