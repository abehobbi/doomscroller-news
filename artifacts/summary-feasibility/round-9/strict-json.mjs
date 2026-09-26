const fail=(message)=>{throw new SyntaxError(message)};
export function parseStrict(text){
  let i=0;const ws=()=>{while(/\s/.test(text[i]??''))i++};
  const value=()=>{ws();const c=text[i];if(c==='"')return string();if(c==='{')return object();if(c==='[')return array();if(text.startsWith('true',i)){i+=4;return true}if(text.startsWith('false',i)){i+=5;return false}if(text.startsWith('null',i)){i+=4;return null}const m=text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);if(m){i+=m[0].length;return Number(m[0])}fail(`Invalid JSON at ${i}`)};
  const string=()=>{const start=i++;while(i<text.length){if(text[i]==='"'){i++;return JSON.parse(text.slice(start,i))}if(text[i]==='\\')i++;i++}fail('Unterminated JSON string')};
  const array=()=>{i++;const a=[];ws();if(text[i]===']'){i++;return a}for(;;){a.push(value());ws();if(text[i]===']'){i++;return a}if(text[i++]!==',')fail(`Expected comma at ${i-1}`)}};
  const object=()=>{i++;const o={},keys=new Set();ws();if(text[i]==='}'){i++;return o}for(;;){ws();if(text[i]!=='"')fail(`Expected key at ${i}`);const k=string();if(keys.has(k))fail(`Duplicate JSON key: ${k}`);keys.add(k);ws();if(text[i++]!==':')fail(`Expected colon at ${i-1}`);o[k]=value();ws();if(text[i]==='}'){i++;return o}if(text[i++]!==',')fail(`Expected comma at ${i-1}`)}};
  const out=value();ws();if(i!==text.length)fail(`Trailing JSON at ${i}`);return out;
}
