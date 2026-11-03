/* =====================================================================
   RH FASHION — script.js
   ===================== BACKEND CONFIGURATION (EDIT HERE) ===============
   Paste your Supabase Project URL and the "anon / public" key only.
   NEVER paste the service_role key in this file.                         */
const SUPABASE_URL = 'https://vptulfdmmbcndxckqgvi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vxoyBhb5BVdfsgUnJBxpeA_q-9RppiG';
const CURRENCY = '$';
/* ======================= END CONFIGURATION ===========================

   ---- ONE-TIME DATABASE SETUP: paste everything between the lines
   ---- below into Supabase > SQL Editor > New query > Run ----
-----------------------------------------------------------------------
create table profiles(id uuid primary key references auth.users on delete cascade, full_name text, email text, role text default 'customer');
create table categories(id serial primary key, name text unique not null);
create table products(id serial primary key, name text not null, price numeric not null check(price>=0), description text, category_id int references categories on delete set null, stock int default 0 check(stock>=0), image_url text, created_at timestamptz default now());
create table banners(id serial primary key, title text, image_url text);
create table orders(id serial primary key, user_id uuid references auth.users, customer_name text, phone text, address text, total numeric default 0, status text default 'Pending', created_at timestamptz default now());
create table order_items(id serial primary key, order_id int references orders on delete cascade, product_id int, name text, price numeric, qty int);

create function is_admin() returns boolean language sql security definer stable set search_path=public as $$ select exists(select 1 from profiles where id=auth.uid() and role='admin') $$;
create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into profiles(id,full_name,email) values(new.id,new.raw_user_meta_data->>'full_name',new.email); return new; end $$;
create trigger on_signup after insert on auth.users for each row execute function handle_new_user();

alter table profiles enable row level security; alter table categories enable row level security; alter table products enable row level security;
alter table banners enable row level security; alter table orders enable row level security; alter table order_items enable row level security;
create policy "own profile" on profiles for select using (id=auth.uid() or is_admin());
create policy "read cats" on categories for select using (true);
create policy "admin cats" on categories for all using (is_admin()) with check (is_admin());
create policy "read prods" on products for select using (true);
create policy "admin prods" on products for all using (is_admin()) with check (is_admin());
create policy "read banners" on banners for select using (true);
create policy "admin banners" on banners for all using (is_admin()) with check (is_admin());
create policy "read orders" on orders for select using (user_id=auth.uid() or is_admin());
create policy "admin orders" on orders for update using (is_admin()) with check (is_admin());
create policy "read items" on order_items for select using (exists(select 1 from orders o where o.id=order_id and (o.user_id=auth.uid() or is_admin())));

create function place_order(p_name text,p_phone text,p_addr text,p_items jsonb) returns int language plpgsql security definer set search_path=public as $$
declare oid int; it jsonb; pr products; t numeric:=0; q int;
begin
 if auth.uid() is null then raise exception 'Please log in'; end if;
 insert into orders(user_id,customer_name,phone,address) values(auth.uid(),p_name,p_phone,p_addr) returning id into oid;
 for it in select * from jsonb_array_elements(p_items) loop
  q:=(it->>'qty')::int;
  select * into pr from products where id=(it->>'id')::int for update;
  if pr.id is null or q<1 or pr.stock<q then raise exception 'Not enough stock for %',coalesce(pr.name,'an item'); end if;
  update products set stock=stock-q where id=pr.id;
  insert into order_items(order_id,product_id,name,price,qty) values(oid,pr.id,pr.name,pr.price,q);
  t:=t+pr.price*q;
 end loop;
 update orders set total=t where id=oid; return oid;
end $$;

insert into storage.buckets(id,name,public) values('images','images',true);
create policy "img read" on storage.objects for select using (bucket_id='images');
create policy "img admin" on storage.objects for all using (bucket_id='images' and is_admin()) with check (bucket_id='images' and is_admin());

insert into categories(name) values ('Men''s Clothing'),('Women''s Clothing'),('T-Shirts'),('Shirts'),('Pants & Jeans'),('Shoes'),('Sneakers'),('Sandals'),('Fashion Accessories'),('Watches'),('Bags');
-----------------------------------------------------------------------
   FIRST ADMIN: sign up on the site, confirm your Gmail, then run in SQL Editor:
   update profiles set role='admin' where email='you@gmail.com';
   ===================================================================== */

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => CURRENCY + Number(n || 0).toFixed(2);
const STAT = ['Pending','Processing','Shipped','Delivered','Cancelled'];
const PH = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect fill="#e9e5dd" width="100%" height="100%"/></svg>');
let S = {user:null, profile:null, cats:[], prods:[], banners:[], cat:null, q:'', v:'home', goAdmin:0, cart:JSON.parse(localStorage.getItem('rh_cart') || '[]')};

function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('on'),3000)}
function modal(h){$('#md').innerHTML=h;$('#ov').classList.add('on')}
function closeModal(){$('#ov').classList.remove('on')}
function app(h){$('#app').innerHTML=h}
function route(v){S.v=v;scrollTo(0,0);({home,acct,admin:()=>admin()})[v]()}

async function load(){
  const [c,p,b]=await Promise.all([sb.from('categories').select('*').order('name'),sb.from('products').select('*').order('created_at',{ascending:false}),sb.from('banners').select('*').order('id')]);
  S.cats=c.data||[];S.prods=p.data||[];S.banners=b.data||[];
}
async function init(){
  sb.auth.onAuthStateChange((ev,ses)=>{setTimeout(async()=>{
    S.user=ses?.user||null;S.profile=null;
    if(S.user){const{data}=await sb.from('profiles').select('*').eq('id',S.user.id).single();S.profile=data}
    if(ev==='PASSWORD_RECOVERY')newPwForm();
    nav();
  },0)});
  await load();route('home');nav();
}
function nav(){
  $('#nv').innerHTML=`<button onclick="route('home')">Shop</button>${S.profile?.role==='admin'?`<button onclick="route('admin')">Admin</button>`:''}<button onclick="S.user?route('acct'):authForm('login')">${S.user?'Account':'Log in'}</button><button onclick="cart()">Cart (${S.cart.reduce((a,i)=>a+i.qty,0)})</button>`;
  if(!S.user&&['acct','admin'].includes(S.v))route('home');
  else if(S.goAdmin&&S.profile?.role==='admin'){S.goAdmin=0;route('admin')}
}

/* ---------- Storefront ---------- */
const card=p=>`<div class="card"><img src="${esc(p.image_url||PH)}" alt="${esc(p.name)}" onclick="detail(${p.id})"><div class="ci"><h3>${esc(p.name)}</h3><b>${money(p.price)}</b>${p.stock>0?`<button onclick="add(${p.id})">Add to cart</button>`:'<span class="oos">Out of stock</span>'}</div></div>`;
function home(){
  const q=S.q.toLowerCase();
  const L=S.prods.filter(p=>(!S.cat||p.category_id==S.cat)&&(p.name+' '+(p.description||'')).toLowerCase().includes(q));
  app(`<div class="hero">${S.banners.length?S.banners.map(b=>`<div class="bn" style="background-image:url('${esc(b.image_url)}')"><h2>${esc(b.title)}</h2></div>`).join(''):'<div class="bn def"><h2>New season. Sharper style.</h2></div>'}</div>
  <div class="chips"><button class="${S.cat?'':'on'}" onclick="S.cat=null;home()">All</button>${S.cats.map(c=>`<button class="${S.cat==c.id?'on':''}" onclick="S.cat=${c.id};home()">${esc(c.name)}</button>`).join('')}</div>
  <div class="grid">${L.map(card).join('')||'<p class="pad">No products found.</p>'}</div>`);
}
function detail(id){
  const p=S.prods.find(x=>x.id==id);
  modal(`<img class="dimg" src="${esc(p.image_url||PH)}" alt=""><h2>${esc(p.name)}</h2><b>${money(p.price)}</b><p>${esc(p.description)}</p><p><small>${p.stock>0?p.stock+' in stock':'Out of stock'}</small></p>${p.stock>0?`<input id="dq" type="number" min="1" max="${p.stock}" value="1"><button class="btn" onclick="add(${p.id},Math.max(1,+$('#dq').value||1));closeModal()">Add to cart</button>`:''}`);
}

/* ---------- Cart & checkout ---------- */
function saveCart(){localStorage.setItem('rh_cart',JSON.stringify(S.cart));nav()}
function add(id,q=1){
  const p=S.prods.find(x=>x.id==id);let i=S.cart.find(x=>x.id==id);const n=(i?i.qty:0)+q;
  if(n>p.stock)return toast('Only '+p.stock+' in stock');
  i?i.qty=n:S.cart.push({id,qty:q});saveCart();toast('Added to cart');
}
function qty(id,d){
  const i=S.cart.find(x=>x.id==id),p=S.prods.find(x=>x.id==id);i.qty+=d;
  if(p&&i.qty>p.stock){i.qty=p.stock;toast('Stock limit reached')}
  if(i.qty<1)S.cart=S.cart.filter(x=>x.id!=id);saveCart();cart();
}
function cart(){
  const L=S.cart.map(i=>({...i,p:S.prods.find(x=>x.id==i.id)})).filter(i=>i.p);
  const t=L.reduce((a,i)=>a+i.p.price*i.qty,0);
  modal(`<h2>Your cart</h2>${L.map(i=>`<div class="row"><span>${esc(i.p.name)}<br><small>${money(i.p.price)}</small></span><span><button onclick="qty(${i.id},-1)">−</button> ${i.qty} <button onclick="qty(${i.id},1)">+</button> <button onclick="qty(${i.id},-99)">Remove</button></span></div>`).join('')||'<p>Your cart is empty.</p>'}${L.length?`<p class="tot">Total: ${money(t)}</p><button class="btn" onclick="checkout()">Checkout</button>`:''}`);
}
function checkout(){
  if(!S.user){toast('Log in to place your order');return authForm('login')}
  modal(`<h2>Checkout</h2><form onsubmit="place(event)"><input name="n" placeholder="Full name" required value="${esc(S.profile?.full_name)}"><input name="p" type="tel" placeholder="Phone number" required><textarea name="a" placeholder="Delivery address" required></textarea><label class="cod"><input type="radio" checked> Cash on Delivery</label><button class="btn">Place order</button></form>`);
}
async function place(e){
  e.preventDefault();const f=new FormData(e.target);
  const{data,error}=await sb.rpc('place_order',{p_name:f.get('n'),p_phone:f.get('p'),p_addr:f.get('a'),p_items:S.cart.map(i=>({id:i.id,qty:i.qty}))});
  if(error)return toast(error.message);
  S.cart=[];saveCart();await load();
  modal(`<h2>Order confirmed</h2><p>Your order #${data} is placed. Pay cash when it arrives.</p><button class="btn" onclick="closeModal();route('acct')">View my orders</button>`);
}

/* ---------- Auth & account ---------- */
function authForm(m){
  const T={login:'Log in',signup:'Create account',forgot:'Reset password'}[m];
  modal(`<h2>${T}</h2><form onsubmit="auth(event,'${m}')">${m=='signup'?'<input name="n" placeholder="Full name" required>':''}<input name="e" type="email" placeholder="Gmail address" required>${m!='forgot'?'<input name="p" type="password" placeholder="Password (min 8 characters)" minlength="8" required>':''}<button class="btn">${T}</button></form><p class="links">${m!='login'?'<a onclick="authForm(\'login\')">Log in</a>':'<a onclick="authForm(\'signup\')">Create account</a> &nbsp; <a onclick="authForm(\'forgot\')">Forgot password?</a>'}</p>`);
}
async function auth(e,m){
  e.preventDefault();const f=new FormData(e.target),em=f.get('e').trim().toLowerCase();
  if(!/^[^\s@]+@gmail\.com$/.test(em))return toast('Use a Gmail address (name@gmail.com)');
  let r;
  if(m=='signup')r=await sb.auth.signUp({email:em,password:f.get('p'),options:{data:{full_name:f.get('n').trim()}}});
  else if(m=='login')r=await sb.auth.signInWithPassword({email:em,password:f.get('p')});
  else r=await sb.auth.resetPasswordForEmail(em,{redirectTo:location.href.split('#')[0]});
  if(r.error)return toast(r.error.message);
  closeModal();
  toast(m=='login'?'Welcome back':m=='signup'&&!r.data.session?'Check your Gmail to confirm your account':m=='signup'?'Account created':'Reset link sent to your Gmail');
}
function newPwForm(){modal(`<h2>Set a new password</h2><form onsubmit="newpw(event)"><input name="p" type="password" minlength="8" placeholder="New password" required><button class="btn">Save password</button></form>`)}
async function newpw(e){e.preventDefault();const{error}=await sb.auth.updateUser({password:new FormData(e.target).get('p')});error?toast(error.message):(closeModal(),toast('Password updated'))}
async function acct(){
  if(!S.user)return authForm('login');
  const{data}=await sb.from('orders').select('*,order_items(*)').eq('user_id',S.user.id).order('id',{ascending:false});
  app(`<section class="pad"><h2>My profile</h2><p>${esc(S.profile?.full_name)}<br>${esc(S.user.email)}</p><button onclick="sb.auth.signOut()">Log out</button><h2 style="margin-top:24px">Order history</h2>${(data||[]).map(o=>`<div class="ord"><b>#${o.id}</b> &nbsp; ${new Date(o.created_at).toLocaleDateString()} &nbsp; ${money(o.total)} &nbsp; <span class="st">${o.status}</span><ul>${o.order_items.map(i=>`<li>${esc(i.name)} × ${i.qty}</li>`).join('')}</ul></div>`).join('')||'<p>No orders yet.</p>'}</section>`);
}

/* ---------- Admin panel (server-enforced by Supabase RLS) ---------- */
async function admin(t='dash'){
  if(S.profile?.role!=='admin')return app('<p class="pad">Admin access only.</p>');
  let b='';
  if(t=='dash'){
    const{data:o}=await sb.from('orders').select('total,status');const{count:u}=await sb.from('profiles').select('*',{count:'exact',head:true});
    const A=o||[],ok=A.filter(x=>x.status!='Cancelled');
    b=`<div class="stats">${[['Total sales',money(ok.reduce((a,x)=>a+ +x.total,0))],['Orders',A.length],['Pending orders',A.filter(x=>x.status=='Pending').length],['Products',S.prods.length],['Low stock (5 or fewer)',S.prods.filter(p=>p.stock<=5).length],['Customers',u]].map(([k,v])=>`<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>`;
  }
  if(t=='prod')b=`<button class="btn" onclick="pform()">Add product</button><div class="tw"><table><tr><th></th><th>Name</th><th>Price</th><th>Stock</th><th></th></tr>${S.prods.map(p=>`<tr><td><img class="th" src="${esc(p.image_url||PH)}" alt=""></td><td>${esc(p.name)}</td><td>${money(p.price)}</td><td>${p.stock}</td><td><button onclick="pform(${p.id})">Edit</button> <button onclick="pdel(${p.id})">Delete</button></td></tr>`).join('')}</table></div>`;
  if(t=='ord'){
    const{data}=await sb.from('orders').select('*,order_items(*)').order('id',{ascending:false});
    b=(data||[]).map(o=>`<div class="ord"><b>#${o.id}</b> &nbsp; ${new Date(o.created_at).toLocaleString()} &nbsp; ${money(o.total)}<br>${esc(o.customer_name)} · ${esc(o.phone)}<br>${esc(o.address)}<ul>${o.order_items.map(i=>`<li>${esc(i.name)} × ${i.qty}</li>`).join('')}</ul><select onchange="ostat(${o.id},this.value)">${STAT.map(s=>`<option ${s==o.status?'selected':''}>${s}</option>`).join('')}</select></div>`).join('')||'<p>No orders yet.</p>';
  }
  if(t=='cat')b=`<form class="row" onsubmit="cadd(event)"><input name="n" placeholder="New category" required><button class="btn">Add</button></form>${S.cats.map(c=>`<div class="row">${esc(c.name)}<span><button onclick="cren(${c.id})">Rename</button> <button onclick="cdel(${c.id})">Delete</button></span></div>`).join('')}`;
  if(t=='ban')b=`<form class="row" onsubmit="badd(event)"><input name="t" placeholder="Banner title"><input name="img" type="file" accept="image/*" required><button class="btn">Add</button></form>${S.banners.map(x=>`<div class="row"><img class="th" src="${esc(x.image_url)}" alt="">${esc(x.title)}<button onclick="bdel(${x.id})">Delete</button></div>`).join('')}`;
  app(`<div class="tabs">${[['dash','Dashboard'],['prod','Products'],['ord','Orders'],['cat','Categories'],['ban','Banners']].map(([k,n])=>`<button class="${k==t?'on':''}" onclick="admin('${k}')">${n}</button>`).join('')}</div><div class="adm">${b}</div>`);
}
async function upload(file){
  const path=Date.now()+'-'+file.name.replace(/[^\w.]/g,'_');
  const{error}=await sb.storage.from('images').upload(path,file);if(error)throw error;
  return sb.storage.from('images').getPublicUrl(path).data.publicUrl;
}
async function db(q,tab){const{error}=await q;if(error)return toast(error.message);await load();admin(tab);toast('Saved')}
function pform(id){
  const p=S.prods.find(x=>x.id==id)||{};
  modal(`<h2>${id?'Edit':'Add'} product</h2><form onsubmit="psave(event,${id||0})"><input name="name" placeholder="Name" required value="${esc(p.name)}"><input name="price" type="number" step="0.01" min="0" placeholder="Price" required value="${p.price??''}"><input name="stock" type="number" min="0" placeholder="Stock" required value="${p.stock??''}"><select name="category_id"><option value="">Category</option>${S.cats.map(c=>`<option value="${c.id}" ${c.id==p.category_id?'selected':''}>${esc(c.name)}</option>`).join('')}</select><textarea name="description" placeholder="Description">${esc(p.description)}</textarea><input name="img" type="file" accept="image/*"><button class="btn">Save product</button></form>`);
}
async function psave(e,id){
  e.preventDefault();const f=new FormData(e.target);
  const r={name:f.get('name'),price:+f.get('price'),stock:+f.get('stock'),category_id:f.get('category_id')||null,description:f.get('description')};
  try{
    const file=f.get('img');if(file&&file.size)r.image_url=await upload(file);
    const{error}=id?await sb.from('products').update(r).eq('id',id):await sb.from('products').insert(r);if(error)throw error;
    closeModal();await load();admin('prod');toast('Product saved');
  }catch(x){toast(x.message)}
}
function pdel(id){confirm('Delete this product?')&&db(sb.from('products').delete().eq('id',id),'prod')}
function ostat(id,s){sb.from('orders').update({status:s}).eq('id',id).then(({error})=>toast(error?error.message:'Status updated'))}
function cadd(e){e.preventDefault();db(sb.from('categories').insert({name:new FormData(e.target).get('n').trim()}),'cat')}
function cren(id){const n=prompt('New name');n&&db(sb.from('categories').update({name:n.trim()}).eq('id',id),'cat')}
function cdel(id){confirm('Delete category? Its products stay, uncategorised.')&&db(sb.from('categories').delete().eq('id',id),'cat')}
async function badd(e){
  e.preventDefault();const f=new FormData(e.target);
  try{const url=await upload(f.get('img'));db(sb.from('banners').insert({title:f.get('t'),image_url:url}),'ban')}catch(x){toast(x.message)}
}
function bdel(id){db(sb.from('banners').delete().eq('id',id),'ban')}

init();
