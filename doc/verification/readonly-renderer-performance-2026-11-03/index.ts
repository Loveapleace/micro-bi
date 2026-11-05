export const load = (name) => name === 'vtable' ? import('./vtable') : import('./univer');
export const cells = (rows,cols,shift=0) => Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>c===0?'DEV-'+String(r).padStart(5,'0'):c===1?'正常':r*cols+c+shift));
export const paint = () => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));