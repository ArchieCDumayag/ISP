document.addEventListener('DOMContentLoaded', () => {
    const addCoverageModal = document.getElementById('add-coverage-modal');
    const addBtn = document.querySelector('.add-btn');
    const closeBtn = addCoverageModal.querySelector('.close-btn');
    const addCoverageForm = document.getElementById('add-coverage-form');
    const tableBody = document.querySelector('.card-table tbody');
    const searchBar = document.getElementById('search-bar');

    const API_URL = 'http://localhost:3000/api/coverage';

    // --- Modal Handling ---
    addBtn.addEventListener('click', () => {
        addCoverageModal.style.display = 'block';
    });

    const closeModal = () => {
        addCoverageModal.style.display = 'none';
        addCoverageForm.reset();
    };

    closeBtn.addEventListener('click', closeModal);

    window.addEventListener('click', (event) => {
        if (event.target === addCoverageModal) {
            closeModal();
        }
    });

    // --- API and Table Rendering ---
    const renderTable = (areas) => {
        tableBody.innerHTML = ''; // Clear existing rows
        if (areas.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No coverage areas found.</td></tr>';
            return;
        }

        areas.forEach(area => {
            const row = document.createElement('tr');
            row.setAttribute('data-id', area.id);
            row.innerHTML = `
                <td>${area.areaName}</td>
                <td>${area.coordinates}</td>
                <td><span class="status ${area.status.toLowerCase()}">${area.status}</span></td>
                <td>
                    <button class="edit-btn"><i class="fa-solid fa-pen"></i> Edit</button>
                    <button class="delete-btn"><i class="fa-solid fa-trash"></i> Delete</button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    };

    const fetchCoverageAreas = async () => {
        try {
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error('Network response was not ok');
            const areas = await response.json();
            renderTable(areas);
        } catch (error) {
            console.error('Failed to fetch coverage areas:', error);
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Error loading data.</td></tr>';
        }
    };

    // --- Event Listeners ---
    addCoverageForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(addCoverageForm);
        const data = Object.fromEntries(formData.entries());

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload.msg || 'Failed to add area');
            }
            closeModal();
            fetchCoverageAreas(); // Refresh table
        } catch (error) {
            console.error('Error submitting form:', error);
            alert(error.message || 'Failed to add coverage area.');
        }
    });

    tableBody.addEventListener('click', async (event) => {
        if (event.target.closest('.delete-btn')) {
            const row = event.target.closest('tr');
            const areaId = row.dataset.id;
            const confirmed = window.appConfirm
                ? await window.appConfirm('Are you sure you want to delete this area?', { title: 'Delete Area' })
                : window.confirm('Are you sure you want to delete this area?');
            if (confirmed) {
                try {
                    const response = await fetch(`${API_URL}/${areaId}`, { method: 'DELETE' });
                    if (!response.ok) throw new Error('Failed to delete');
                    row.remove();
                } catch (error) {
                    console.error('Error deleting area:', error);
                    alert('Failed to delete area.');
                }
            }
        }
        // TODO: Add logic for edit button
    });

    searchBar.addEventListener('keyup', () => {
        const filter = searchBar.value.toUpperCase();
        const rows = tableBody.getElementsByTagName('tr');
        Array.from(rows).forEach(row => {
            const areaNameCell = row.getElementsByTagName('td')[0];
            const areaName = areaNameCell ? areaNameCell.textContent || areaNameCell.innerText : '';
            row.style.display = areaName.toUpperCase().includes(filter) ? '' : 'none';
        });
    });

    // Initial load
    fetchCoverageAreas();
});
