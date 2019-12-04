fetch('/dwarves').then(x => x.json()).then(json => document.body.textContent = JSON.stringify(json, null, 2))
