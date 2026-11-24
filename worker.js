// TrendNest - affiliate showcase. One Worker = website + admin + database + media.
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });
const H = (b) => new Response(b, { headers: { "content-type": "text/html;charset=utf-8" } });
let ready = false;

async function save(env, file) {
  if (!file || !file.size) return null;
  const ext = (file.name.match(/\.[a-z0-9]+$/i) || [""])[0];
  const key = crypto.randomUUID() + ext;
  await env.MEDIA.put(key, await file.arrayBuffer(), { metadata: { type: file.type } });
  return key;
}

async function init(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,price TEXT,category TEXT,description TEXT,link TEXT,image TEXT,video TEXT,clicks INTEGER DEFAULT 0)").run();
  ready = true;
}

export default {
  async fetch(req, env, ctx) {
    await init(env);
    const url = new URL(req.url), p = url.pathname;

    if (p === "/") return H(PAGE);
    if (p === "/admin") return H(ADMIN);

    if (p === "/api/products") {
      const { results } = await env.DB.prepare("SELECT id,name,price,category,description,image,video FROM products ORDER BY id DESC").all();
      return J(results);
    }

    if (p.startsWith("/go/")) {
      const id = p.slice(4);
      const r = await env.DB.prepare("SELECT link FROM products WHERE id=?").bind(id).first();
      if (!r) return new Response("Not found", { status: 404 });
      ctx.waitUntil(env.DB.prepare("UPDATE products SET clicks=clicks+1 WHERE id=?").bind(id).run());
      return Response.redirect(r.link, 302);
    }

    if (p.startsWith("/media/")) {
      const { value, metadata } = await env.MEDIA.getWithMetadata(p.slice(7), { type: "arrayBuffer", cacheTtl: 3600 });
      if (!value) return new Response("Not found", { status: 404 });
      const size = value.byteLength;
      const h = new Headers({ "content-type": (metadata && metadata.type) || "application/octet-stream", "accept-ranges": "bytes", "cache-control": "public,max-age=31536000,immutable" });
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
      if (m) {
        const s = m[1] === "" ? Math.max(size - Number(m[2]), 0) : Number(m[1]);
        const e = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
        if (s >= size) return new Response(null, { status: 416, headers: { "content-range": "bytes */" + size } });
        h.set("content-range", "bytes " + s + "-" + e + "/" + size);
        return new Response(value.slice(s, e + 1), { status: 206, headers: h });
      }
      return new Response(value, { headers: h });
    }

    if (p.startsWith("/api/admin/")) {
      if (!env.ADMIN_KEY || req.headers.get("x-admin-key") !== env.ADMIN_KEY) return J({ error: "Wrong admin key" }, 401);

      if (p === "/api/admin/products" && req.method === "GET") {
        const { results } = await env.DB.prepare("SELECT id,name,price,category,clicks FROM products ORDER BY id DESC").all();
        return J(results);
      }

      if (p === "/api/admin/products" && req.method === "POST") {
        const f = await req.formData();
        const link = (f.get("link") || "").trim();
        if (!f.get("name") || !/^https?:\/\//.test(link)) return J({ error: "Name and a full link (https://...) are required" }, 400);
        const big = [f.get("image"), f.get("video")].some((x) => x && x.size > 24 * 1024 * 1024);
        if (big) return J({ error: "File too big. Keep pictures and videos under 24MB" }, 400);
        const image = await save(env, f.get("image"));
        const video = await save(env, f.get("video"));
        await env.DB.prepare("INSERT INTO products(name,price,category,description,link,image,video) VALUES(?,?,?,?,?,?,?)")
          .bind(f.get("name"), f.get("price") || "", f.get("category") || "General", f.get("description") || "", link, image, video).run();
        return J({ ok: true });
      }

      if (p.startsWith("/api/admin/products/") && req.method === "DELETE") {
        const id = p.split("/").pop();
        const r = await env.DB.prepare("SELECT image,video FROM products WHERE id=?").bind(id).first();
        if (r) { if (r.image) await env.MEDIA.delete(r.image); if (r.video) await env.MEDIA.delete(r.video); }
        await env.DB.prepare("DELETE FROM products WHERE id=?").bind(id).run();
        return J({ ok: true });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TrendNest - Trending finds</title>
<meta name="description" content="Hand-picked trending finds. Tap, shop, save.">
<style>
:root{--bg:#0d0b1f;--pink:#ff4d8d;--violet:#7c5cff;--amber:#ffb703;--card:#171433;--mut:#b8b3d9}
*{box-sizing:border-box;margin:0}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:#fff;overflow-x:hidden}
.bg{position:fixed;inset:0;z-index:-1;overflow:hidden}
.bg i{position:absolute;border-radius:50%;filter:blur(70px);opacity:.45;animation:fl 14s ease-in-out infinite}
.bg i:nth-child(1){width:320px;height:320px;background:var(--pink);top:-80px;left:-60px}
.bg i:nth-child(2){width:360px;height:360px;background:var(--violet);bottom:-100px;right:-80px;animation-delay:-5s}
.bg i:nth-child(3){width:240px;height:240px;background:var(--amber);top:45%;left:55%;animation-delay:-9s}
@keyframes fl{50%{transform:translate(40px,-50px) scale(1.15)}}
#splash{position:fixed;inset:0;background:var(--bg);display:grid;place-items:center;z-index:99;transition:opacity .6s,visibility .6s}
#splash b{font-size:2.6rem;background:linear-gradient(90deg,var(--pink),var(--amber));-webkit-background-clip:text;background-clip:text;color:transparent;animation:pop 1s ease both}
@keyframes pop{from{transform:scale(.5);opacity:0}}
.hide{opacity:0;visibility:hidden}
header{text-align:center;padding:46px 18px 12px}
h1{font-size:2.6rem;letter-spacing:-1px;background:linear-gradient(90deg,var(--pink),var(--amber),var(--violet),var(--pink));background-size:300%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:sh 6s linear infinite}
.tag{color:var(--mut);margin-top:8px}
.chips{display:flex;gap:8px;overflow-x:auto;padding:14px 16px;scrollbar-width:none;max-width:1100px;margin:auto}
.chip{flex:none;padding:9px 18px;border-radius:99px;border:1px solid #ffffff30;background:#ffffff10;color:#fff;font-size:.9rem;cursor:pointer}
.chip.on{background:linear-gradient(90deg,var(--pink),var(--violet));border-color:transparent}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px;padding:8px 16px 50px;max-width:1100px;margin:auto}
.card{background:var(--card);border-radius:20px;overflow:hidden;border:1px solid #ffffff18;opacity:0;transform:translateY(30px);transition:opacity .6s,transform .6s,box-shadow .3s}
.card.in{opacity:1;transform:none}
.card:hover{box-shadow:0 10px 40px #7c5cff66}
.media{position:relative;aspect-ratio:4/5;background:#000}
.media video,.media img{width:100%;height:100%;object-fit:cover;display:block}
.price{position:absolute;top:10px;left:10px;background:var(--amber);color:#111;font-weight:700;padding:5px 12px;border-radius:99px}
.info{padding:14px}
.info h3{font-size:1.05rem}
.info p{color:var(--mut);font-size:.88rem;margin:6px 0 12px}
.buy{display:block;text-align:center;padding:14px;border-radius:14px;font-weight:700;color:#fff;text-decoration:none;background:linear-gradient(90deg,var(--pink),var(--violet),var(--pink));background-size:200%;animation:sh 3s linear infinite}
@keyframes sh{to{background-position:200% 0}}
.empty{text-align:center;color:var(--mut);padding:60px 20px;grid-column:1/-1}
footer{text-align:center;color:var(--mut);font-size:.78rem;padding:0 20px 40px}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head><body>
<div class="bg"><i></i><i></i><i></i></div>
<div id="splash"><b>TrendNest</b></div>
<header><h1>TrendNest</h1><p class="tag">Trending finds, picked for you. Tap and shop.</p></header>
<div class="chips" id="chips"></div>
<main class="grid" id="grid"></main>
<footer>As an affiliate, I may earn a commission when you buy through my links, at no extra cost to you.</footer>
<script>
var all=[],cat="All";
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function chips(){
  var cs=["All"];all.forEach(function(p){if(cs.indexOf(p.category)<0)cs.push(p.category)});
  var el=document.getElementById("chips");el.innerHTML="";
  if(cs.length<3)return;
  cs.forEach(function(c){var b=document.createElement("button");b.className="chip"+(c===cat?" on":"");b.textContent=c;b.onclick=function(){cat=c;chips();render()};el.appendChild(b)});
}
function render(){
  var g=document.getElementById("grid"),list=all.filter(function(p){return cat==="All"||p.category===cat});
  var pid=new URLSearchParams(location.search).get("p");
  if(pid){list.sort(function(a,b){return (String(b.id)===pid)-(String(a.id)===pid)})}
  if(!list.length){g.innerHTML='<div class="empty">New finds are dropping soon. Check back later.</div>';return}
  g.innerHTML=list.map(function(p){
    var img=p.image?"/media/"+p.image:"";
    var m=p.video?'<video src="/media/'+p.video+'" poster="'+img+'" muted loop playsinline preload="metadata"></video>':(img?'<img src="'+img+'" alt="'+esc(p.name)+'" loading="lazy">':"");
    return '<article class="card"><div class="media">'+m+(p.price?'<span class="price">'+esc(p.price)+'</span>':"")+'</div><div class="info"><h3>'+esc(p.name)+'</h3><p>'+esc(p.description)+'</p><a class="buy" href="/go/'+p.id+'" rel="sponsored noopener">Buy now</a></div></article>';
  }).join("");
  var io=new IntersectionObserver(function(es){es.forEach(function(e){
    if(e.isIntersecting){e.target.classList.add("in");var v=e.target.querySelector("video");if(v){v.muted=true;v.play().catch(function(){})}}
    else{var v2=e.target.querySelector("video");if(v2)v2.pause()}
  })},{threshold:.35});
  document.querySelectorAll(".card").forEach(function(c){io.observe(c)});
}
function done(){setTimeout(function(){document.getElementById("splash").classList.add("hide")},700)}
fetch("/api/products").then(function(r){return r.json()}).then(function(d){all=d;chips();render();done()}).catch(function(){render();done()});
</script></body></html>`;

const ADMIN = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>TrendNest Admin</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0d0b1f;color:#fff;margin:0;padding:16px;max-width:640px;margin:auto}
h2{background:linear-gradient(90deg,#ff4d8d,#ffb703);-webkit-background-clip:text;background-clip:text;color:transparent}
input,textarea,button{width:100%;padding:12px;margin:5px 0;border-radius:10px;border:1px solid #ffffff30;background:#171433;color:#fff;font-size:1rem}
button{background:linear-gradient(90deg,#ff4d8d,#7c5cff);border:0;font-weight:700}
label{font-size:.85rem;color:#b8b3d9}
.row{display:flex;justify-content:space-between;align-items:center;background:#171433;border-radius:12px;padding:12px;margin:8px 0;gap:10px}
.row button{width:auto;padding:8px 14px;background:#ff4d8d}.clk{color:#ffb703;font-weight:700}
</style></head><body>
<h2>TrendNest Admin</h2>
<input id="key" type="password" placeholder="Admin key">
<button onclick="load()">Log in</button>
<form id="f" style="margin-top:18px">
<input name="name" placeholder="Product name" required>
<input name="price" placeholder="Price (e.g. $12.99 or N5,000)">
<input name="category" placeholder="Category (e.g. Home, Beauty, Gadgets)">
<textarea name="description" rows="2" placeholder="Short description"></textarea>
<input name="link" placeholder="Your affiliate link (https://...)" required>
<label>Picture</label><input name="image" type="file" accept="image/*">
<label>Video (short, under 24MB)</label><input name="video" type="file" accept="video/*">
<button id="add">Add product</button>
</form>
<p id="msg"></p><h3>Products and clicks</h3><div id="list"></div>
<script>
var K=document.getElementById("key");K.value=localStorage.getItem("k")||"";
function hd(){return{"x-admin-key":K.value}}
function load(){
  localStorage.setItem("k",K.value);
  fetch("/api/admin/products",{headers:hd()}).then(function(r){return r.json()}).then(function(d){
    var l=document.getElementById("list");
    if(d.error){l.textContent=d.error;return}
    l.innerHTML=d.map(function(p){return '<div class="row"><div>'+p.name.replace(/</g,"&lt;")+'<br><span class="clk">'+p.clicks+' clicks</span></div><div><button onclick="cp('+p.id+')">Copy ad link</button> <button onclick="del('+p.id+')">Delete</button></div></div>'}).join("")||"No products yet.";
  });
}
function cp(id){var u=location.origin+"/?p="+id;(navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){alert("Copied: "+u)}).catch(function(){prompt("Copy this link:",u)})}
function del(id){if(confirm("Delete this product?"))fetch("/api/admin/products/"+id,{method:"DELETE",headers:hd()}).then(load)}
document.getElementById("f").onsubmit=function(e){
  e.preventDefault();var m=document.getElementById("msg"),b=document.getElementById("add");
  b.disabled=true;m.textContent="Uploading, please wait...";
  fetch("/api/admin/products",{method:"POST",headers:hd(),body:new FormData(e.target)}).then(function(r){return r.json()}).then(function(d){
    b.disabled=false;m.textContent=d.ok?"Added!":(d.error||"Failed");
    if(d.ok){e.target.reset();load()}
  }).catch(function(){b.disabled=false;m.textContent="Upload failed"});
};
if(K.value)load();
</script></body></html>`;
