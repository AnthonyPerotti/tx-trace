let mainChartInstance = null;
let categoryChartInstance = null;
let currentChartType = 'bar';
let currentChartData = [];

function initDashboard(initialChartData, categoryData) {
  currentChartData = initialChartData;

  renderMainChart(currentChartType, currentChartData);
  if (categoryData && categoryData.length > 0) {
    renderCategoryChart(categoryData);
  }

  const periodSelect = document.getElementById('periodSelect');
  if (periodSelect) {
    periodSelect.addEventListener('change', (e) => {
      loadChartPeriod(e.target.value);
    });
  }
}

function setChartType(type, buttonElement) {
  currentChartType = type;
  document.querySelectorAll('.chart-type-btn').forEach(btn => btn.classList.remove('active'));
  if (buttonElement) buttonElement.classList.add('active');
  renderMainChart(currentChartType, currentChartData);
}

function loadChartPeriod(period) {
  const urlParams = new URLSearchParams(window.location.search);
  const year = urlParams.get('year') || new Date().getFullYear();
  const month = urlParams.get('month') || (new Date().getMonth() + 1);
  const institutionId = urlParams.get('institution_id') || '';
  const viewMode = urlParams.get('view_mode') || 'transactions';

  let fetchUrl = `/api/chart?period=${period}&year=${year}&month=${month}&view_mode=${viewMode}`;
  if (institutionId) fetchUrl += `&institution_id=${institutionId}`;

  fetch(fetchUrl)
    .then(res => res.json())
    .then(data => {
      currentChartData = data;
      renderMainChart(currentChartType, currentChartData);
    })
    .catch(err => console.error('Erro ao carregar dados do gráfico:', err));
}

function renderMainChart(type, data) {
  const ctx = document.getElementById('mainChart');
  if (!ctx) return;

  if (mainChartInstance) {
    mainChartInstance.destroy();
  }

  const labels = data.map(d => d.label);
  const incomes = data.map(d => d.income);
  const expenses = data.map(d => d.expenses);

  let chartTypeConfig = type;
  let fillOption = false;

  if (type === 'area') {
    chartTypeConfig = 'line';
    fillOption = true;
  }

  const datasets = [
    {
      label: 'Receitas',
      data: incomes,
      backgroundColor: type === 'area' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(16, 185, 129, 0.85)',
      borderColor: '#10b981',
      borderWidth: 2,
      borderRadius: type === 'bar' ? 4 : 0,
      fill: fillOption,
      tension: 0.35,
      pointBackgroundColor: '#10b981',
      pointRadius: type === 'bar' ? 0 : 4
    },
    {
      label: 'Despesas',
      data: expenses,
      backgroundColor: type === 'area' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(239, 68, 68, 0.85)',
      borderColor: '#ef4444',
      borderWidth: 2,
      borderRadius: type === 'bar' ? 4 : 0,
      fill: fillOption,
      tension: 0.35,
      pointBackgroundColor: '#ef4444',
      pointRadius: type === 'bar' ? 0 : 4
    }
  ];

  mainChartInstance = new Chart(ctx, {
    type: chartTypeConfig,
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#8fa3be',
            font: { family: 'Inter', size: 12 }
          }
        },
        tooltip: {
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
          grid: { color: 'rgba(28, 45, 71, 0.4)' },
          ticks: { color: '#8fa3be', font: { family: 'Inter', size: 11 } }
        },
        y: {
          grid: { color: 'rgba(28, 45, 71, 0.4)' },
          ticks: {
            color: '#8fa3be',
            font: { family: 'Inter', size: 11 },
            callback: function(value) {
              return 'R$ ' + value.toLocaleString('pt-BR');
            }
          }
        }
      }
    }
  });
}

function renderCategoryChart(data) {
  const ctx = document.getElementById('categoryChart');
  if (!ctx) return;

  if (categoryChartInstance) {
    categoryChartInstance.destroy();
  }

  const labels = data.map(d => `${d.icon} ${d.name}`);
  const values = data.map(d => d.total);
  const colors = data.map(d => d.color || '#6366f1');

  categoryChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#0f1929'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.parsed;
              return `${context.label}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)}`;
            }
          }
        }
      }
    }
  });
}
