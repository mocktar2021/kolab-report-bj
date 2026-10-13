// Shared by the server layout (inline script) and the client hook in
// sidebar-state.ts. Keep this module free of "use client".
export const SIDEBAR_STORAGE_KEY = "kolabreport:sidebar";
export const SIDEBAR_COLLAPSED = "collapsed";

/**
 * Inline script for the layout: sets <html data-sidebar="collapsed"> before
 * first paint, so a collapsed sidebar never flashes open on reload. Storage
 * can throw in private mode or when blocked; the sidebar then stays open.
 */
export const SIDEBAR_INIT_SCRIPT = `try{if(window.localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})===${JSON.stringify(SIDEBAR_COLLAPSED)}){document.documentElement.dataset.sidebar=${JSON.stringify(SIDEBAR_COLLAPSED)}}}catch(e){}`;
