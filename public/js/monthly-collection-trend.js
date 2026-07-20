document.addEventListener('DOMContentLoaded', function () {

    // Monthly Trend Line Chart
    const monthlyTrendCtx = document.getElementById('monthlyTrendChart').getContext('2d');
    const monthlyTrendChart = new Chart(monthlyTrendCtx, {
        type: 'line',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
            datasets: [{
                label: 'Billed',
                data: [250, 300, 320, 310, 330, 340, 350, 360, 370, 380, 390, 400],
                borderColor: '#007BFF',
                backgroundColor: 'rgba(0, 123, 255, 0.1)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#007BFF',
                pointBorderWidth: 2,
                pointHoverRadius: 6,
                pointHoverBorderColor: '#fff',
            }, {
                label: 'Collected',
                data: [220, 270, 310, 280, 315, 320, 330, 340, 350, 360, 370, 380],
                borderColor: '#4CAF50',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#4CAF50',
                pointBorderWidth: 2,
                pointHoverRadius: 6,
                pointHoverBorderColor: '#fff',
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '₱' + (value / 1000) + 'k';
                        }
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index',
            }
        }
    });

    // Payment Channels Pie Chart
    const paymentChannelsCtx = document.getElementById('paymentChannelsChart').getContext('2d');
    const paymentChannelsChart = new Chart(paymentChannelsCtx, {
        type: 'doughnut',
        data: {
            labels: ['GCash', 'Bank Transfer', 'Walk-in', 'Maya'],
            datasets: [{
                label: 'Payment Channels',
                data: [45, 25, 20, 10],
                backgroundColor: [
                    '#2E86DE', // GCash Blue
                    '#48BB78', // Bank Green
                    '#F6AD55', // Walk-in Orange
                    '#9F7AEA', // Maya Purple
                ],
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                }
            }
        }
    });

});