// State Management
const state = {
    currentView: 'user', // 'user' or 'admin'
    isAdmin: false,
    config: {
        densityRule: 5000, // 1 dealer per 5000 inhabitants
        occupiedCities: [], // Array of objects: { city, uf, dealers }
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
            }
        },
        title: {
            text: '',
            style: { color: '#fff' }
        },
        mapNavigation: {
            enabled: true,
            buttonOptions: {
                verticalAlign: 'bottom'
            }
        },
        colorAxis: {
            min: 0,
            minColor: '#333',
            maxColor: '#fff',
            labels: {
                style: { color: '#888' }
            }
        },
        series: [{
            data: data,
            name: 'Revendedores',
            states: {
                hover: {
                    color: '#fff'
                }
            },
            dataLabels: {
                enabled: true,
                format: '{point.name}',
                style: {
                    color: '#ccc',
                    textOutline: 'none',
                    fontWeight: 'normal'
                }
            },
            tooltip: {
                pointFormat: '{point.name}: {point.value} Revendedores'
            },
            borderColor: '#333',
            borderWidth: 1
        }]
    });
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
    }
}

// --- Data Loading ---
async function loadAllCities() {
    try {
        const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios');
        const data = await response.json();
        state.allCities = data.map(city => ({
            name: city.nome,
            uf: city.microrregiao.mesorregiao.UF.sigla,
            id: city.id
        }));
        console.log(`Carregadas ${state.allCities.length} cidades.`);
    } catch (error) {
        console.error('Erro ao carregar lista de cidades:', error);
        showToast('Erro ao carregar base de cidades.', 'error');
    }
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

// --- Search Logic ---
async function handleSearch() {
    const query = elements.inputs.search.value.trim();
    if (!query) return;

    elements.buttons.search.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    elements.buttons.search.disabled = true;
    elements.containers.result.classList.add('hidden');

    try {
        const cleanQuery = query.replace(/\D/g, '');
        if (cleanQuery.length === 8) {
            await searchByCep(cleanQuery);
        } else {
            searchByName(query);
        }
    } catch (error) {
        console.error(error);
        showToast('Erro na busca.', 'error');
    } finally {
        elements.buttons.search.innerHTML = '<i class="fa-solid fa-search"></i>';
        elements.buttons.search.disabled = false;
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
        showCitySelectionModal(matches);
    }
}

function showCitySelectionModal(cities) {
    const container = elements.containers.result;
    container.classList.remove('hidden');

    let html = `<div class="glass-card"><h3 style="margin-bottom:1rem;">Selecione a Cidade:</h3><ul class="city-list">`;
    cities.forEach(city => {
        html += `<li onclick="selectCity('${city.name}', '${city.uf}', '${city.id}')" class="city-option">
            ${city.name} - ${city.uf}
        </li>`;
    });
    html += `</ul></div>`;
    container.innerHTML = html;
}

window.selectCity = async function (name, uf, id) {
    await processLocationSelection(name, uf, id);
};

async function processLocationSelection(city, uf, ibgeId) {
    const population = await getCityPopulation(ibgeId);
    state.selectedLocation = { city, uf, ibgeId, population };
    checkAvailability();

    // Map Highlight
    if (state.mapChart) {
        const key = `br-${uf.toLowerCase()}`;
        const point = state.mapChart.series[0].points.find(p => p['hc-key'] === key);
        if (point) {
            point.zoomTo();
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
                <a href="#" class="cta-btn-result">Quero ser um Revendedor</a>
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
