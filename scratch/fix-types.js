const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'types', 'supabase.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Replace all 'club_id: string;' with 'club_id?: string;' to allow TS overlap checks
content = content.replace(/club_id:\s*string;/g, 'club_id?: string;');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully patched club_id types to optional!');
