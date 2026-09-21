// electron/preload.cjs — the only bridge between the sandboxed renderer
// (the React app) and the main process. Nothing here touches Node/fs
// directly from the renderer's perspective; every call goes through
// ipcRenderer.invoke to the handlers registered in main.cjs.
const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('api', {
  tasks: {
    getAll: () => invoke('tasks:getAll'),
    create: (data) => invoke('tasks:create', data),
    update: (id, data) => invoke('tasks:update', id, data),
    delete: (id) => invoke('tasks:delete', id),
    toggle: (id) => invoke('tasks:toggle', id),
  },
  subtasks: {
    getFor: (taskId) => invoke('subtasks:getFor', taskId),
    create: (taskId, title) => invoke('subtasks:create', taskId, title),
    toggle: (id) => invoke('subtasks:toggle', id),
    delete: (id) => invoke('subtasks:delete', id),
  },
  events: {
    getAll: () => invoke('events:getAll'),
    create: (data) => invoke('events:create', data),
    update: (id, data) => invoke('events:update', id, data),
    delete: (id) => invoke('events:delete', id),
  },
  finance: {
    getAll: () => invoke('finance:getAll'),
    create: (data) => invoke('finance:create', data),
    delete: (id) => invoke('finance:delete', id),
    summary: () => invoke('finance:summary'),
    getCategories: () => invoke('finance:getCategories'),
    createCategory: (name) => invoke('finance:createCategory', name),
    renameCategory: (oldName, newName) => invoke('finance:renameCategory', oldName, newName),
    deleteCategory: (name) => invoke('finance:deleteCategory', name),
    reorderCategories: (names) => invoke('finance:reorderCategories', names),
    getBudgets: () => invoke('finance:getBudgets'),
    setBudget: (category, limit) => invoke('finance:setBudget', category, limit),
    deleteBudget: (category) => invoke('finance:deleteBudget', category),
    getRecurring: () => invoke('finance:getRecurring'),
    createRecurring: (data) => invoke('finance:createRecurring', data),
    toggleRecurring: (id) => invoke('finance:toggleRecurring', id),
    deleteRecurring: (id) => invoke('finance:deleteRecurring', id),
    exportPdf: () => invoke('finance:exportPdf'),
    createTransfer: (data) => invoke('finance:createTransfer', data),
  },
  accounts: {
    getAll: () => invoke('accounts:getAll'),
    create: (data) => invoke('accounts:create', data),
    update: (id, data) => invoke('accounts:update', id, data),
    archive: (id) => invoke('accounts:archive', id),
    unarchive: (id) => invoke('accounts:unarchive', id),
    delete: (id) => invoke('accounts:delete', id),
  },
  savings: {
    getAll: () => invoke('savings:getAll'),
    summary: () => invoke('savings:summary'),
    getEntries: (goalId) => invoke('savings:getEntries', goalId),
    createGoal: (data) => invoke('savings:createGoal', data),
    updateGoal: (id, data) => invoke('savings:updateGoal', id, data),
    archiveGoal: (id) => invoke('savings:archiveGoal', id),
    unarchiveGoal: (id) => invoke('savings:unarchiveGoal', id),
    deleteGoal: (id) => invoke('savings:deleteGoal', id),
    addEntry: (goalId, data) => invoke('savings:addEntry', goalId, data),
    deleteEntry: (id) => invoke('savings:deleteEntry', id),
  },
  debts: {
    getAll: () => invoke('debts:getAll'),
    summary: () => invoke('debts:summary'),
    getPayments: (debtId) => invoke('debts:getPayments', debtId),
    create: (data) => invoke('debts:create', data),
    update: (id, data) => invoke('debts:update', id, data),
    delete: (id) => invoke('debts:delete', id),
    addPayment: (id, data) => invoke('debts:addPayment', id, data),
    settle: (id, data) => invoke('debts:settle', id, data),
    deletePayment: (paymentId) => invoke('debts:deletePayment', paymentId),
  },
  phone: {
    getStatus: () => invoke('phone:getStatus'),
    setEnabled: (on) => invoke('phone:setEnabled', on),
    setQuiet: (data) => invoke('phone:setQuiet', data),
    sendTest: () => invoke('phone:sendTest'),
  },
  ai: {
    getSettings: () => invoke('ai:getSettings'),
    saveSettings: (data) => invoke('ai:saveSettings', data),
    clearKey: () => invoke('ai:clearKey'),
    parseTransaction: (text) => invoke('ai:parseTransaction', text),
    generateInsights: () => invoke('ai:generateInsights'),
  },
  habits: {
    getAll: () => invoke('habits:getAll'),
    create: (data) => invoke('habits:create', data),
    update: (id, data) => invoke('habits:update', id, data),
    delete: (id) => invoke('habits:delete', id),
    archive: (id) => invoke('habits:archive', id),
    unarchive: (id) => invoke('habits:unarchive', id),
    toggleLog: (habitId, date) => invoke('habits:toggleLog', habitId, date),
    getLogs: (habitId, from, to) => invoke('habits:getLogs', habitId, from, to),
  },
  notes: {
    getAll: () => invoke('notes:getAll'),
    create: (data) => invoke('notes:create', data),
    update: (id, data) => invoke('notes:update', id, data),
    delete: (id) => invoke('notes:delete', id),
  },
  attachments: {
    pick: () => invoke('attachments:pick'),
    add: (parentType, parentId, filePath) => invoke('attachments:add', parentType, parentId, filePath),
    getFor: (parentType, parentId) => invoke('attachments:getFor', parentType, parentId),
    remove: (id, parentType) => invoke('attachments:remove', id, parentType),
    openInFolder: (filePath) => invoke('attachments:openInFolder', filePath),
  },
  profile: {
    get: () => invoke('profile:get'),
    update: (data) => invoke('profile:update', data),
    pickAvatar: () => invoke('profile:pickAvatar'),
    hasPin: () => invoke('profile:hasPin'),
    setPin: (pin) => invoke('profile:setPin', pin),
    clearPin: () => invoke('profile:clearPin'),
    verifyPin: (pin) => invoke('profile:verifyPin', pin),
  },
  settings: {
    getAutoLaunch: () => invoke('settings:getAutoLaunch'),
    setAutoLaunch: (enabled) => invoke('settings:setAutoLaunch', enabled),
  },
  drive: {
    getStatus: () => invoke('drive:getStatus'),
    saveCredentials: (data) => invoke('drive:saveCredentials', data),
    connect: () => invoke('drive:connect'),
    disconnect: () => invoke('drive:disconnect'),
    setAutoBackup: (data) => invoke('drive:setAutoBackup', data),
    backupNow: () => invoke('drive:backupNow'),
    listBackups: () => invoke('drive:listBackups'),
    restore: (fileId) => invoke('drive:restore', fileId),
  },
  app: {
    quit: () => invoke('app:quit'),
    openExternal: (url) => invoke('app:openExternal', url),
    copyText: (text) => invoke('app:copyText', text),
  },
  data: {
    listTables: () => invoke('data:listTables'),
    getRows: (key, opts) => invoke('data:getRows', key, opts),
    deleteRow: (key, id) => invoke('data:deleteRow', key, id),
    setArchived: (key, id, archived) => invoke('data:setArchived', key, id, archived),
  },
  onDbChanged: (callback) => {
    const handler = (_e, payload) => callback(payload)
    ipcRenderer.on('db:changed', handler)
    return () => ipcRenderer.removeListener('db:changed', handler)
  },
})
