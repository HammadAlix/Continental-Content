"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { MERCH_SIZES, money, type MerchGroup } from "@/lib/merch";
import type { AdminProduct } from "@/lib/admin-product";
import "./StoreAdmin.css";

type History = { id: number; productId: string; revision: number; createdAt: string };
type Draft = AdminProduct & { imageData?: string | null };
const newProduct = (): Draft => ({ id: "", name: "", category: "", description: "",
  group: "hoodies", sizes: ["S", "M", "L", "XL"], price: 6000, published: false, revision: 0 });

export default function StoreAdmin() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [price, setPrice] = useState("");
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const locked = useRef(false);
  const photoGeneration = useRef(0);
  const editor = useRef<HTMLHeadingElement>(null);

  async function refresh(signal?: AbortSignal) {
    const response = await fetch("/api/admin/products", { cache: "no-store", signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load products.");
    setProducts(data.products); setHistory(data.history);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/products", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Could not load products.");
        return response.json();
      }).then(data => {
        if (!controller.signal.aborted) { setProducts(data.products); setHistory(data.history); }
      }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load store management. Please refresh.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);

  function edit(product: Draft) {
    if (draft && !window.confirm("Discard the open editor and switch products?")) return;
    photoGeneration.current++;
    setPhotoBusy(false); setDraft({ ...product }); setPrice((product.price / 100).toFixed(2));
    setError(""); setMessage("");
    window.setTimeout(() => editor.current?.focus(), 0);
  }
  async function photo(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError("Choose a JPEG, PNG or WebP photo of at most 2 MB."); return;
    }
    const generation = ++photoGeneration.current;
    setPhotoBusy(true); setError("");
    try {
      const value = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read photo."));
        reader.readAsDataURL(file);
      });
      if (generation === photoGeneration.current) setDraft(current => current ? { ...current, imageData: value } : null);
    } catch { setError("Could not read the photo. Please try again."); }
    finally { if (generation === photoGeneration.current) setPhotoBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || locked.current || photoBusy) return;
    if (!/^\d+(?:\.\d{1,2})?$/.test(price)) { setError("Enter a dollar price with at most two decimal places."); return; }
    locked.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/products", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, price: Math.round(Number(price) * 100) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save.");
      setDraft(null); setMessage("Saved. New visits to the store and new checkouts use this catalogue.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Save could not be confirmed. Refresh before retrying."); }
    finally { locked.current = false; setBusy(false); }
  }
  const visible = products.filter(p => `${p.name} ${p.id}`.toLowerCase().includes(filter.toLowerCase()));
  const preview = draft?.imageData === null ? undefined : draft?.imageData || draft?.imageUrl;

  return <div className="store-admin">
    <div className="store-admin-toolbar">
      <button disabled={busy || loading} onClick={() => edit(newProduct())}>Add product</button>
      <button disabled={busy} onClick={async () => {
        setError(""); setLoading(true);
        try { await refresh(); } catch { setError("Could not refresh. Try again shortly."); }
        finally { setLoading(false); }
      }}>Refresh list</button>
      <a href="/merch" target="_blank" rel="noreferrer">View store ↗</a>
    </div>
    <p role="status">{message || (loading ? "Loading products…" : `${products.length} products · USD`)}</p>
    {error && <p role="alert" className="store-admin-error">{error}</p>}
    <label>Find a product<input type="search" value={filter} onChange={e => setFilter(e.target.value)} /></label>
    <div className="store-admin-list" aria-label="Products">
      {visible.map(product => <button key={product.id} disabled={busy} onClick={() => edit(product)}>
        <strong>{product.name}</strong><span>{money(product.price)} · {product.published ? "Published" : "Hidden / draft"}</span>
      </button>)}
      {!loading && !visible.length && <p>No matching products.</p>}
    </div>
    {draft && <form onSubmit={save} className="store-admin-editor">
      <h2 ref={editor} tabIndex={-1}>{draft.revision ? "Edit product" : "New product"}</h2>
      <fieldset disabled={busy || photoBusy}>
        <label>Product ID (cannot change after creation)<input required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*"
          readOnly={draft.revision > 0} value={draft.id} placeholder="continental-new-hoodie"
          onChange={e => setDraft({ ...draft, id: e.target.value })} /></label>
        <label>Name<input required maxLength={100} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <div className="store-admin-columns">
          <label>Price (USD)<input required type="number" min="0.50" max="10000" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></label>
          <label>Collection<select value={draft.group} onChange={e => setDraft({ ...draft, group: e.target.value as MerchGroup })}>
            <option value="hoodies">Hoodies</option><option value="tees">T-shirts</option><option value="jackets">Jackets</option><option value="slides">Slides</option>
          </select></label>
        </div>
        <label>Short category label<input required maxLength={100} value={draft.category} placeholder="Minimalist white hoodie"
          onChange={e => setDraft({ ...draft, category: e.target.value })} /></label>
        <label>Description<textarea rows={4} maxLength={2000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <fieldset className="store-admin-sizes"><legend>Available sizes</legend>
          {MERCH_SIZES.map(size => <label key={size}><input type="checkbox" checked={draft.sizes.includes(size)}
            onChange={e => setDraft({ ...draft, sizes: e.target.checked ? [...draft.sizes, size] : draft.sizes.filter(s => s !== size) })} />{size}</label>)}
        </fieldset>
        <label>Product photo (JPEG, PNG or WebP, up to 2 MB)<input key={draft.id + draft.revision} type="file" accept="image/jpeg,image/png,image/webp"
          onChange={e => { void photo(e.target.files?.[0]); e.target.value = ""; }} /></label>
        {preview && <Image unoptimized src={preview} alt="Product photo preview" width={240} height={240} className="store-admin-preview" />}
        {preview && <button type="button" onClick={() => setDraft({ ...draft, imageData: null })}>Remove photo on save</button>}
        <label className="store-admin-check"><input type="checkbox" checked={draft.published} onChange={e => setDraft({ ...draft, published: e.target.checked })} />
          Published — visible and available for new checkouts</label>
        <p>Uncheck Published to hide a product. Existing orders are preserved. Previously opened Stripe sessions may still be payable.</p>
        <div className="store-admin-toolbar">
          <button type="submit">{busy ? "Saving…" : "Save product"}</button>
          <button type="button" onClick={() => { if (window.confirm("Discard this editor?")) setDraft(null); }}>Cancel</button>
        </div>
      </fieldset>
      {photoBusy && <p role="status">Reading photo…</p>}
    </form>}
    <details><summary>Recent saved changes</summary>
      <ul>{history.map(item => <li key={item.id}>{item.productId} · revision {item.revision} · {new Date(item.createdAt).toLocaleString()}</li>)}</ul>
      {!history.length && <p>No changes recorded yet.</p>}
    </details>
  </div>;
}
