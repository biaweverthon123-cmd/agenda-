const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const weekdayNames = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

const elements = {
  monthName: document.querySelector('#monthName'), yearName: document.querySelector('#yearName'),
  summaryDay: document.querySelector('#summaryDay'), summaryWeekday: document.querySelector('#summaryWeekday'),
  summaryMonth: document.querySelector('#summaryMonth'), summaryYear: document.querySelector('#summaryYear'),
  days: document.querySelector('#calendarDays'), slots: document.querySelector('#timeSlots'),
  reminder: document.querySelector('#reminder'), detailDate: document.querySelector('#detailDate'),
  detailTime: document.querySelector('#detailTime'), detailReminder: document.querySelector('#detailReminder'),
  history: document.querySelector('#historyList'), saveButton: document.querySelector('#saveAppointment')
};

const today = new Date();
let visibleDate = new Date(today.getFullYear(), today.getMonth(), 1);
let selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
let selectedTime = '';
let appointments = [];
let editingAppointment = null;

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatLongDate(date) {
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Não foi possível acessar o backend.');
  return body;
}

async function loadMonthlyHistory() {
  const year = visibleDate.getFullYear();
  const month = String(visibleDate.getMonth() + 1).padStart(2, '0');
  appointments = await requestJson(`/api/history?year=${year}&month=${month}`);
}

function updateDetails() {
  elements.summaryDay.textContent = selectedDate.getDate();
  elements.summaryWeekday.textContent = weekdayNames[selectedDate.getDay()];
  elements.summaryMonth.textContent = monthNames[selectedDate.getMonth()];
  elements.summaryYear.textContent = selectedDate.getFullYear();
  elements.detailDate.textContent = formatLongDate(selectedDate);
  const latest = appointments.filter(item => item.date === dateKey(selectedDate)).at(-1);
  elements.detailTime.textContent = selectedTime || latest?.time || '-';
  elements.detailReminder.textContent = elements.reminder.value.trim() || latest?.reminder || 'Sem lembrete';
}

function renderCalendar() {
  const year = visibleDate.getFullYear();
  const month = visibleDate.getMonth();
  elements.monthName.textContent = monthNames[month];
  elements.yearName.textContent = year;
  elements.days.innerHTML = '';
  const firstWeekday = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const previousTotal = new Date(year, month, 0).getDate();

  for (let index = 0; index < 42; index += 1) {
    const day = index - firstWeekday + 1;
    const itemDate = new Date(year, month, day);
    const outside = day < 1 || day > totalDays;
    const label = day < 1 ? previousTotal + day : day > totalDays ? day - totalDays : day;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `day-button${outside ? ' outside' : ''}`;
    button.textContent = label;
    if (dateKey(itemDate) === dateKey(selectedDate)) button.classList.add('selected');
    if (appointments.some(item => item.date === dateKey(itemDate))) button.classList.add('has-appointment');
    button.addEventListener('click', async () => {
      const changedMonth = itemDate.getMonth() !== visibleDate.getMonth() || itemDate.getFullYear() !== visibleDate.getFullYear();
      selectedDate = itemDate;
      visibleDate = new Date(itemDate.getFullYear(), itemDate.getMonth(), 1);
      selectedTime = '';
      elements.reminder.value = '';
      if (changedMonth) await refreshMonth(); else renderAll();
    });
    elements.days.appendChild(button);
  }
}

function renderTimeSlots() {
  elements.slots.innerHTML = '';
  for (let minutes = 8 * 60; minutes <= 15 * 60; minutes += 30) {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `time-button${selectedTime === time ? ' selected' : ''}`;
    button.textContent = time;
    button.addEventListener('click', () => {
      selectedTime = selectedTime === time ? '' : time;
      renderTimeSlots(); updateDetails();
    });
    elements.slots.appendChild(button);
  }
}

function renderHistory() {
  elements.history.innerHTML = '';
  const sorted = [...appointments].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  if (!sorted.length) {
    const item = document.createElement('li');
    item.textContent = `Nenhum agendamento em ${monthNames[visibleDate.getMonth()]} de ${visibleDate.getFullYear()}.`;
    elements.history.appendChild(item);
    return;
  }

  sorted.forEach(appointment => {
    const item = document.createElement('li');
    const created = document.createElement('strong');
    const description = document.createElement('span');
    const actions = document.createElement('div');
    created.className = 'history-date';
    created.textContent = `Criado: ${formatLongDate(new Date(`${appointment.date}T12:00:00`))}`;
    description.className = 'history-description';
    description.textContent = [appointment.time, appointment.reminder].filter(Boolean).join(' - ') || 'Sem lembrete';
    actions.className = 'history-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'edit-button';
    edit.textContent = 'Editar';
    edit.addEventListener('click', () => {
      editingAppointment = appointment;
      selectedDate = new Date(`${appointment.date}T12:00:00`);
      selectedTime = appointment.time || '';
      elements.reminder.value = appointment.reminder || '';
      elements.saveButton.textContent = 'Atualizar';
      renderAll();
      elements.reminder.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Apagar';
    remove.addEventListener('click', async () => {
      try {
        await requestJson(`/api/appointments/${appointment.id}?date=${appointment.date}`, { method: 'DELETE' });
        await refreshMonth();
      } catch (error) { alert(error.message); }
    });
    actions.append(edit, remove);
    item.append(created, description, actions);
    elements.history.appendChild(item);
  });
}

function renderAll() {
  renderCalendar(); renderTimeSlots(); renderHistory(); updateDetails();
}

async function refreshMonth() {
  try {
    await loadMonthlyHistory();
    renderAll();
  } catch (error) {
    appointments = [];
    renderAll();
    alert(error.message);
  }
}

document.querySelector('#prevMonth').addEventListener('click', async () => {
  editingAppointment = null;
  elements.saveButton.textContent = 'Próximo';
  visibleDate = new Date(visibleDate.getFullYear(), visibleDate.getMonth() - 1, 1);
  selectedDate = new Date(visibleDate);
  selectedTime = '';
  await refreshMonth();
});

document.querySelector('#nextMonth').addEventListener('click', async () => {
  editingAppointment = null;
  elements.saveButton.textContent = 'Próximo';
  visibleDate = new Date(visibleDate.getFullYear(), visibleDate.getMonth() + 1, 1);
  selectedDate = new Date(visibleDate);
  selectedTime = '';
  await refreshMonth();
});

elements.reminder.addEventListener('input', updateDetails);

elements.saveButton.addEventListener('click', async () => {
  elements.saveButton.disabled = true;
  try {
    const payload = { date: dateKey(selectedDate), time: selectedTime, reminder: elements.reminder.value.trim() };
    if (editingAppointment) {
      await requestJson(`/api/appointments/${editingAppointment.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...payload, originalDate: editingAppointment.date })
      });
      alert('Agendamento atualizado com sucesso.');
    } else {
      await requestJson('/api/appointments', { method: 'POST', body: JSON.stringify(payload) });
      alert('Agendamento salvo com sucesso.');
    }
    editingAppointment = null;
    elements.saveButton.textContent = 'Próximo';
    selectedTime = '';
    elements.reminder.value = '';
    await refreshMonth();
  } catch (error) {
    alert(error.message);
  } finally {
    elements.saveButton.disabled = false;
  }
});

refreshMonth();
