export const cardSchema={
  type:'object',
  additionalProperties:false,
  properties:{
    headline:{type:'string',minLength:1},
    pages:{type:'array',minItems:1,maxItems:3,items:{type:'object',additionalProperties:false,properties:{text:{type:'string',minLength:1}},required:['text']}},
    uncertainties:{type:'array',items:{type:'string',minLength:1}}
  },
  required:['headline','pages']
};

const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function auditSchema(x){
  const expectedTop=new Set(['headline','pages','uncertainties']);
  const unknownTop=object(x)?Object.keys(x).filter(k=>!expectedTop.has(k)):[];
  const missing=[];if(!object(x)||typeof x.headline!=='string'||!x.headline.trim())missing.push('headline');if(!object(x)||!Array.isArray(x.pages))missing.push('pages');
  const misplaced=[];if(Array.isArray(x?.pages))x.pages.forEach((p,i)=>{if(object(p)&&Object.hasOwn(p,'uncertainties'))misplaced.push(`pages[${i}].uncertainties`);});
  const pageProblems=[];if(Array.isArray(x?.pages)){if(x.pages.length<1||x.pages.length>3)pageProblems.push('page_count');x.pages.forEach((p,i)=>{if(!object(p))pageProblems.push(`pages[${i}]_not_object`);else{const keys=Object.keys(p);if(keys.length!==1||keys[0]!=='text')pageProblems.push(`pages[${i}]_unexpected_properties`);if(typeof p.text!=='string'||!p.text.trim())pageProblems.push(`pages[${i}].text`);}});}
  const uncertaintyProblem=Object.hasOwn(x??{},'uncertainties')&&(!Array.isArray(x.uncertainties)||x.uncertainties.some(v=>typeof v!=='string'||!v.trim()));
  return {valid:object(x)&&unknownTop.length===0&&missing.length===0&&misplaced.length===0&&pageProblems.length===0&&!uncertaintyProblem,unknownProperties:unknownTop,missingProperties:missing,misplacedProperties:misplaced,pageProblems,uncertaintyProblem};
}
