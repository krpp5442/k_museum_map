/* 대한민국 박물관 지도
   행정구역 경계 GeoJSON은 공개 저장소의 가공 자료를 불러옵니다.
   배포 전에는 파일을 내려받아 프로젝트 내부에 보관하는 방식을 권장합니다.
*/
const GEO = {
  sido: "https://cdn.jsdelivr.net/gh/KnellBalm/kr-admin-geojson@main/ctprvn.geojson",
  sigungu: "https://cdn.jsdelivr.net/gh/KnellBalm/kr-admin-geojson@main/sig.geojson"
};
const REGIONS = [
  {id:"seoul",name:"서울특별시",geo:"서울특별시",code:"11"},
  {id:"gyeonggi",name:"경기도",geo:"경기도",code:"41",includeMetros:["28"]},
  {id:"gangwon",name:"강원도",geo:"강원특별자치도",code:"51",codes:["51","42"]},
  {id:"chungbuk",name:"충청북도",geo:"충청북도",code:"43"},
  {id:"chungnam",name:"충청남도",geo:"충청남도",code:"44",includeMetros:["30"]},
  {id:"jeonbuk",name:"전북특별자치도",geo:"전북특별자치도",geoAliases:["전라북도","전북특별자치도"],code:"52",codes:["52","45"]},
  {id:"jeonnam",name:"전라남도",geo:"전라남도",code:"46",includeMetros:["29"]},
  {id:"gyeongbuk",name:"경상북도",geo:"경상북도",code:"47",includeMetros:["27"]},
  {id:"gyeongnam",name:"경상남도",geo:"경상남도",code:"48",includeMetros:["26","31"]},
  {id:"jeju",name:"제주특별자치도",geo:"제주특별자치도",code:"50",codes:["50","49"]}
];

let museumData = {museums:[]};
let sidoData = null, sigunguData = null;
let mainMap = null, detailMap = null, mainLayer = null, detailLayer = null;
let selectedRegion = null, selectedCity = null;
let currentMuseums = [];

const $ = id => document.getElementById(id);
const regionByCode = code => REGIONS.find(r => r.code === String(code).slice(0,2));
const prop = (feature, key) => feature.properties?.[key] ?? "";

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`자료를 불러오지 못했습니다: ${url}`);
  return res.json();
}

async function loadAll() {
  const [museums, sido, sigungu] = await Promise.all([
    getJson("data/museums_with_metros.json"),
    getJson(GEO.sido),
    getJson(GEO.sigungu)
  ]);
  museumData = museums;
  sidoData = sido;
  sigunguData = sigungu;
}

function makeMap(id, center=[36.3,127.8], zoom=7) {
  const map = L.map(id, {scrollWheelZoom:false}).setView(center, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom:18,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);
  return map;
}

function regionForSidoFeature(feature) {
  const name = String(prop(feature,"CTP_KOR_NM") || "").trim();
  const code = String(prop(feature,"CTPRVN_CD") || prop(feature,"CTPRVN_CODE") || "").slice(0,2);
  return REGIONS.find(r =>
    r.geo === name || (r.geoAliases || []).includes(name) ||
    (r.id === "jeonbuk" && ["45","52"].includes(code))
  );
}

function regionFeatureCollection() {
  const features = sidoData.features.filter(f => regionForSidoFeature(f));
  return {type:"FeatureCollection",features};
}

function featureStyle(selected=false) {
  return {color:selected?"#286653":"#80968c",weight:selected?2.5:1.25,fillColor:selected?"#8eb7a0":"#dce9df",fillOpacity:selected?.72:.58};
}

function renderMainMap() {
  mainMap = makeMap("koreaMap",[36.25,127.85],7);
  mainLayer = L.geoJSON(regionFeatureCollection(), {
    style: f => featureStyle(selectedRegion && regionForSidoFeature(f)?.id===selectedRegion.id),
    onEachFeature:(feature,layer)=>{
      const region = regionForSidoFeature(feature);
      if(!region) return;
      layer.bindTooltip(region.name,{sticky:true});
      layer.on({click:()=>selectRegion(region.id),mouseover:e=>e.target.setStyle({fillColor:"#b8d2c1",fillOpacity:.9}),mouseout:e=>mainLayer.resetStyle(e.target)});
    }
  }).addTo(mainMap);
  mainMap.fitBounds(mainLayer.getBounds(),{padding:[12,12]});
}

function renderRegionButtons() {
  const root=$("regionList"); root.innerHTML="";
  REGIONS.forEach(r=>{
    const b=document.createElement("button");
    b.className="region-choice"; b.innerHTML=`<span>${r.name}</span><small>선택 →</small>`;
    b.addEventListener("click",()=>selectRegion(r.id)); root.appendChild(b);
  });
}

function setBreadcrumb(region="",city="") {
  $("crumbRegion").textContent=region; $("crumbCity").textContent=city;
}

function hideAll() {
  ["homePanel","cityPanel","museumPanel","searchPanel"].forEach(id=>$(id).hidden=true);
}

function selectRegion(id) {
  selectedRegion=REGIONS.find(r=>r.id===id); selectedCity=null;
  if(!selectedRegion) return;
  $("globalSearch").value=""; $("localSearch").value="";
  hideAll(); setBreadcrumb(selectedRegion.name,"");
  if(id==="seoul") { showMuseums(); return; }
  $("cityPanel").hidden=false;
  $("cityHeading").textContent=`${selectedRegion.name} 시·군 선택`;
  renderCityMap();
  setTimeout(()=>detailMap.invalidateSize(),80);
}

function rawCityName(feature) {
  const sigName = String(prop(feature,"SIG_KOR_NM") || "").trim();
  const fullName = String(prop(feature,"FULL_NM") || "").trim();
  // GeoJSON 제공처에 따라 SIG_KOR_NM이 "장안구"처럼 구 이름만 담기는 경우가 있어
  // FULL_NM의 마지막 두 행정구역명을 함께 확인합니다.
  const parts = (fullName || sigName).split(/\s+/).filter(Boolean);
  if (sigName.includes(" ")) return sigName.split(/\s+/).slice(-2).join(" ");
  if (/구$/.test(sigName) && parts.length >= 2 && /시$/.test(parts[parts.length-2])) {
    return parts.slice(-2).join(" ");
  }
  return sigName || parts[parts.length-1] || "";
}

// 일반구는 상위 시로 통합합니다.
function normalizeCityName(name) {
  const value = String(name || "").trim();
  const match = value.match(/^(.+시)\s+.+구$/);
  return match ? match[1] : value;
}

const METRO_NAMES = {
  "26":"부산광역시", "28":"인천광역시", "27":"대구광역시", "29":"광주광역시",
  "30":"대전광역시", "31":"울산광역시"
};

function featureSidoCodes(feature) {
  const explicit = String(prop(feature,"CTPRVN_CD") || "").trim();
  const sigCode = String(prop(feature,"SIG_CD") || "").trim();
  return new Set([explicit, sigCode.slice(0,2)].filter(Boolean));
}

function geometryPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

// 시 내부의 여러 일반구 경계를 하나의 시 단위 선택 영역으로 묶습니다.
function getRegionCities() {
  const acceptedCodes = new Set([...(selectedRegion.codes || [selectedRegion.code]), ...(selectedRegion.includeMetros || [])]);
  const source = sigunguData.features.filter(f => [...featureSidoCodes(f)].some(code => acceptedCodes.has(code)));
  const groups = new Map();

  source.forEach(feature => {
    const sidoCode = [...featureSidoCodes(feature)].find(code => METRO_NAMES[code]) ||
      [...featureSidoCodes(feature)].find(code => acceptedCodes.has(code));
    // 광역시는 해당 도를 선택했을 때 하나의 광역시 항목으로 묶어 표시합니다.
    const name = METRO_NAMES[sidoCode] || normalizeCityName(rawCityName(feature));
    if (!groups.has(name)) {
      groups.set(name, {
        type: "Feature",
        properties: {...feature.properties, SIG_KOR_NM: name, FULL_NM: name},
        geometry: {type: "MultiPolygon", coordinates: []}
      });
    }
    const grouped = groups.get(name);
    grouped.geometry.coordinates.push(...geometryPolygons(feature.geometry));
  });

  return [...groups.values()].sort((a,b)=>cityName(a).localeCompare(cityName(b),"ko"));
}

function cityName(feature) {
  return prop(feature,"SIG_KOR_NM") || prop(feature,"FULL_NM").split(" ").slice(-1)[0];
}

function renderCityMap() {
  if(detailMap){detailMap.remove();detailMap=null;}
  detailMap=makeMap("cityMap",[36.3,127.8],8);
  const features=getRegionCities();
  const collection={type:"FeatureCollection",features};
  detailLayer=L.geoJSON(collection,{
    style:()=>featureStyle(false),
    onEachFeature:(feature,layer)=>{
      const name=cityName(feature);
      layer.bindTooltip(name,{sticky:true});
      layer.on({
        click:()=>selectCity(prop(feature,"SIG_CD"),name),
        mouseover:e=>e.target.setStyle({fillColor:"#9bc4a8",fillOpacity:.9}),
        mouseout:e=>detailLayer.resetStyle(e.target)
      });
    }
  }).addTo(detailMap);
  if(detailLayer.getLayers().length) detailMap.fitBounds(detailLayer.getBounds(),{padding:[12,12]});
  renderCityList(features);
}

function renderCityList(features) {
  const root=$("cityList"); root.innerHTML="";
  $("cityCount").textContent=`${features.length}곳`;
  features.forEach(f=>{
    const name=cityName(f), code=prop(f,"SIG_CD");
    const b=document.createElement("button"); b.className="region-choice";
    b.innerHTML=`<span>${name}</span><small>박물관 보기 →</small>`;
    b.addEventListener("click",()=>selectCity(code,name)); root.appendChild(b);
  });
}

function selectCity(code,name) {
  selectedCity={code,name}; setBreadcrumb(selectedRegion.name,name); showMuseums();
}

function museumsForSelection() {
  return museumData.museums.filter(m=>{
    if(selectedRegion.id==="seoul") return m.regionId==="seoul";
    if(!selectedCity || m.regionId!==selectedRegion.id) return false;
    // 박물관 데이터에 구 단위 명칭이 입력된 경우에도 상위 시로 묶습니다.
    return normalizeCityName(m.cityName)===selectedCity.name;
  });
}

function createMuseumCard(m) {
  const card=document.createElement("article"); card.className="museum-card";
  const title=document.createElement("h3"); title.textContent=m.name; card.appendChild(title);
  if(m.address){const p=document.createElement("p");p.textContent=m.address;card.appendChild(p);}
  if(m.description){const p=document.createElement("p");p.textContent=m.description;card.appendChild(p);}
  const meta=document.createElement("div");meta.className="museum-meta";
  meta.textContent=[m.regionName,m.cityName,m.updatedAt?`정보 확인일 ${m.updatedAt}`:""].filter(Boolean).join(" · ");
  if(meta.textContent) card.appendChild(meta);
  if(m.website){
    const a=document.createElement("a");a.href=m.website;a.target="_blank";a.rel="noopener noreferrer";
    a.textContent="공식 홈페이지 바로가기 ↗";card.appendChild(a);
  } else {
    const p=document.createElement("p");p.className="website-unavailable";
    p.textContent=m.websiteNote ? `홈페이지 링크 확인 필요: ${m.websiteNote}` : "홈페이지 링크 확인 필요";
    card.appendChild(p);
  }
  return card;
}

function drawMuseumCards(items,rootId) {
  const root=$(rootId);root.innerHTML="";
  if(!items.length){
    const empty=document.createElement("div");empty.className="empty-state";
    empty.innerHTML="<b>등록된 박물관 정보가 아직 없습니다.</b>박물관의 공식 명칭과 홈페이지 주소를 확인한 뒤 <code>data/museums.json</code>에 추가하면 이곳에 표시됩니다.";
    root.appendChild(empty);return;
  }
  items.forEach(m=>root.appendChild(createMuseumCard(m)));
}

function showMuseums() {
  hideAll();$("museumPanel").hidden=false;
  $("museumHeading").textContent=selectedRegion.id==="seoul"?"서울특별시 박물관":`${selectedCity.name} 박물관`;
  $("backCities").textContent=selectedRegion.id==="seoul"?"지역 선택":"시·군 선택";
  currentMuseums=museumsForSelection();

  $("museumSubheading").textContent =
    "시·군 단위로 박물관을 모아 표시합니다. 기관의 공식 홈페이지는 새 창에서 엽니다.";

  renderMuseumList();
}

function renderMuseumList() {
  const q=$("localSearch").value.trim().toLowerCase();
  const filtered=currentMuseums.filter(m=>[m.name,m.address,m.description].join(" ").toLowerCase().includes(q));
  $("museumCount").textContent=`${filtered.length}개`;
  drawMuseumCards(filtered,"museumList");
}

function runGlobalSearch(query) {
  const q=query.trim().toLowerCase();
  if(!q){$("searchPanel").hidden=true;return;}
  hideAll();$("searchPanel").hidden=false;
  const matches=museumData.museums.filter(m=>[m.name,m.regionName,m.cityName,m.address,m.description].join(" ").toLowerCase().includes(q));
  $("searchCount").textContent=`${matches.length}개`;
  drawMuseumCards(matches,"searchResults");
  setBreadcrumb("검색 결과","");
}

function goHome() {
  selectedRegion=null;selectedCity=null;
  $("globalSearch").value="";$("localSearch").value="";
  hideAll();$("homePanel").hidden=false;setBreadcrumb();
  if(mainMap) setTimeout(()=>mainMap.invalidateSize(),60);
}
$("homeBtn").addEventListener("click",goHome);
$("brandHome").addEventListener("click",e=>{e.preventDefault();goHome();});
$("crumbHome").addEventListener("click",goHome);
$("backRegions").addEventListener("click",goHome);
$("backCities").addEventListener("click",()=>selectedRegion?.id==="seoul"?goHome():(
  hideAll(),$("cityPanel").hidden=false,setTimeout(()=>detailMap.invalidateSize(),60)
));
$("globalSearch").addEventListener("input",e=>runGlobalSearch(e.target.value));
$("clearSearch").addEventListener("click",()=>{$("globalSearch").value="";runGlobalSearch("");});
$("localSearch").addEventListener("input",renderMuseumList);

(async function init(){
  try {
    await loadAll();
    renderRegionButtons();
    renderMainMap();
  } catch(error) {
    console.error(error);
    $("homePanel").innerHTML=`<div class="empty-state"><b>지도 자료를 불러오지 못했습니다.</b>인터넷 연결을 확인하거나 잠시 후 새로고침해 주세요.<br>지도 경계 자료 제공처의 접속 상태에 따라 일시적으로 나타날 수 있습니다.</div>`;
  }
})();
