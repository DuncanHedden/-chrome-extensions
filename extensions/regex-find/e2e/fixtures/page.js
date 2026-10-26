// Point the second iframe at a different origin (a second server, passed in by the test).
const cross = new URLSearchParams(location.search).get('cross');
if (cross) document.getElementById('cross').src = cross + '/frame.html';
// A page-level shortcut handler, to check keystrokes in the find bar don't leak to the page.
window.pageKeydowns = 0;
document.addEventListener('keydown', () => window.pageKeydowns++);
