/**
 * Automated Sanitizing System - Chart Manager
 * Integrates Chart.js with responsive dark mode palettes, real sensor time-series,
 * and handles uncalibrated sensor states cleanly without fabricating data.
 */

class DashboardCharts {
  constructor() {
    this.airQualityChart = null;
    this.sanitizerChart = null;
    this.occupancyChart = null;
    this.maxDataPoints = 30;
  }

  init() {
    this.initAirQualityChart();
    this.initSanitizerChart();
    this.initOccupancyChart();
  }

  _getCommonOptions(yTitle, min = 0, max = null) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 400,
        easing: 'easeOutQuart'
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#94a3b8',
            font: { family: 'Inter', size: 11, weight: '600' },
            boxWidth: 12,
            padding: 12
          }
        },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#ffffff',
          bodyColor: '#38bdf8',
          borderColor: 'rgba(56, 189, 248, 0.3)',
          borderWidth: 1,
          padding: 10,
          displayColors: true,
          boxPadding: 4
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: {
            color: '#64748b',
            font: { family: 'Inter', size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6
          }
        },
        y: {
          min,
          max: max || undefined,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#94a3b8',
            font: { family: 'Inter', size: 10 }
          },
          title: {
            display: !!yTitle,
            text: yTitle,
            color: '#64748b',
            font: { family: 'Inter', size: 10, weight: '600' }
          }
        }
      }
    };
  }

  initAirQualityChart() {
    if (typeof Chart === 'undefined') {
      console.warn('Chart.js library is not loaded. Historical charts are in fallback mode.');
      return;
    }
    const ctx = document.getElementById('airQualityCanvas')?.getContext('2d');
    if (!ctx) return;

    this.airQualityChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'MQ-135 (Raw ADC Reading)',
          data: [],
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.08)',
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5,
          pointBackgroundColor: '#06b6d4',
          fill: true,
          tension: 0.25
        }]
      },
      options: this._getCommonOptions('Raw ADC (0 - 1023)', 0, 1023)
    });
  }

  initSanitizerChart() {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById('sanitizerCanvas')?.getContext('2d');
    if (!ctx) return;

    this.sanitizerChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Raindrop Sensor (Raw ADC)',
            data: [],
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.08)',
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 5,
            fill: true,
            tension: 0.25
          },
          {
            label: 'Calibrated Sanitizer (%)',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [4, 4],
            pointRadius: 2,
            tension: 0.25
          }
        ]
      },
      options: this._getCommonOptions('Sensor Level', 0, 1023)
    });
  }

  initOccupancyChart() {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById('occupancyCanvas')?.getContext('2d');
    if (!ctx) return;

    this.occupancyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Estimated Inside',
            data: [],
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.12)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.2
          },
          {
            label: 'Cumulative Entries',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [3, 3],
            tension: 0.1
          },
          {
            label: 'Cumulative Exits',
            data: [],
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [3, 3],
            tension: 0.1
          }
        ]
      },
      options: this._getCommonOptions('Count / Occupancy', 0, null)
    });
  }

  formatTimestamp(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /**
   * Populate or append history points
   */
  updateHistory(historyRecords) {
    if (!Array.isArray(historyRecords) || historyRecords.length === 0) return;

    const trimmed = historyRecords.slice(-this.maxDataPoints);
    const labels = trimmed.map(r => this.formatTimestamp(r.timestamp));

    // Update Air Quality Chart
    if (this.airQualityChart) {
      this.airQualityChart.data.labels = labels;
      this.airQualityChart.data.datasets[0].data = trimmed.map(r => r.mq135Raw);
      this.airQualityChart.update('none');
    }

    // Update Sanitizer Level Chart
    if (this.sanitizerChart) {
      this.sanitizerChart.data.labels = labels;
      this.sanitizerChart.data.datasets[0].data = trimmed.map(r => r.waterLevelRaw);
      // Calibrated percent (null if uncalibrated)
      this.sanitizerChart.data.datasets[1].data = trimmed.map(r => r.waterLevelPercent);
      this.sanitizerChart.update('none');
    }

    // Update Occupancy Chart
    if (this.occupancyChart) {
      this.occupancyChart.data.labels = labels;
      this.occupancyChart.data.datasets[0].data = trimmed.map(r => r.estimatedOccupancy);
      this.occupancyChart.data.datasets[1].data = trimmed.map(r => r.entryCount);
      this.occupancyChart.data.datasets[2].data = trimmed.map(r => r.exitCount);
      this.occupancyChart.update('none');
    }
  }

  /**
   * Append a single new reading point (only when timestamp is novel)
   */
  appendReading(reading) {
    if (!reading || !reading.receivedAt) return;

    const label = this.formatTimestamp(reading.receivedAt);

    // Air Quality
    if (this.airQualityChart) {
      const chart = this.airQualityChart;
      const lastLabel = chart.data.labels[chart.data.labels.length - 1];
      if (lastLabel !== label) {
        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(reading.mq135Raw);
        if (chart.data.labels.length > this.maxDataPoints) {
          chart.data.labels.shift();
          chart.data.datasets[0].data.shift();
        }
        chart.update();
      }
    }

    // Sanitizer
    if (this.sanitizerChart) {
      const chart = this.sanitizerChart;
      const lastLabel = chart.data.labels[chart.data.labels.length - 1];
      if (lastLabel !== label) {
        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(reading.waterLevelRaw);
        chart.data.datasets[1].data.push(reading.waterLevelPercent);
        if (chart.data.labels.length > this.maxDataPoints) {
          chart.data.labels.shift();
          chart.data.datasets[0].data.shift();
          chart.data.datasets[1].data.shift();
        }
        chart.update();
      }
    }

    // Occupancy
    if (this.occupancyChart) {
      const chart = this.occupancyChart;
      const lastLabel = chart.data.labels[chart.data.labels.length - 1];
      if (lastLabel !== label) {
        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(reading.estimatedOccupancy);
        chart.data.datasets[1].data.push(reading.entryCount);
        chart.data.datasets[2].data.push(reading.exitCount);
        if (chart.data.labels.length > this.maxDataPoints) {
          chart.data.labels.shift();
          chart.data.datasets[0].data.shift();
          chart.data.datasets[1].data.shift();
          chart.data.datasets[2].data.shift();
        }
        chart.update();
      }
    }
  }
}

window.dashboardCharts = new DashboardCharts();
