"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { assets } from "@/assets/assets";
import {
  MERCH_CART_KEY, MERCH_HOTSPOTS, MERCH_PRODUCTS, MERCH_DISPLAYS,
  money, readMerchCart, type CartLine, type MerchProduct, type MerchSize, type MerchHotspot, type MerchGroup,
} from "@/lib/merch";
import "./MerchRoom.css";

type Panel = { kind: "product"; product: MerchProduct } | { kind: "cart" } | { kind: "collection"; group?: MerchGroup };
type Spotlight = { spot: MerchHotspot; liftX: number; liftY: number; labelX: number; labelY: number };

function GarmentCutout({ spot }: { spot: MerchHotspot }) {
  const maskId = `merch-mask-${useId().replace(/:/g, "")}`;
  const { x, y, width, height } = spot.rect;
  // A vector mask reveals untouched source pixels. No generated/repainted product art.
  return <svg className="merch-cutout" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs><clipPath id={maskId}><path d={spot.mask} /></clipPath></defs>
    <image href={assets.merchRoom.src} x={-100 * x / width} y={-100 * y / height}
      width={100 / width} height={100 / height} preserveAspectRatio="none" clipPath={`url(#${maskId})`} />
  </svg>;
}

function ProductImage({ product }: { product: MerchProduct }) {
  return <div className="merch-product-image merch-photo-pending" role="img" aria-label={`Photo coming soon: ${product.name}`}>
    <span aria-hidden="true">CC</span><small>Photo coming soon</small>
  </div>;
}

export default function MerchRoom() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [notice, setNotice] = useState("");
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null);
  const cartReady = useRef(false);
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  useEffect(() => {
    const clear = () => setSpotlight(null);
    window.addEventListener("resize", clear);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("resize", clear);
      window.removeEventListener("blur", clear);
    };
  }, []);

  function showSpotlight(spot: MerchHotspot, element: HTMLButtonElement) {
    if (panel || window.innerWidth < 768) return;
    const rect = element.getBoundingClientRect();
    // Keep the garment anchored; adapt the label rather than lifting the garment
    // far out of its display when a short screen leaves less room underneath.
    const safeLeft = rect.width * .04 + 16;
    const safeRight = window.innerWidth - rect.width * 1.04 - 16;
    const liftX = Math.max(safeLeft, Math.min(rect.left, safeRight)) - rect.left;
    const clampX = (x: number) => Math.max(135, Math.min(window.innerWidth - 135, x));
    const centreX = clampX(rect.left + rect.width / 2 + liftX);
    const controls = Array.from(document.querySelectorAll(".back-to-foyer, .merch-shop-tools"),
      (control) => control.getBoundingClientRect());
    const candidates = [
      { x: centreX, y: rect.bottom + 4 },
      { x: clampX(rect.right + liftX + 142), y: rect.bottom - 64 },
      { x: clampX(rect.left + liftX - 142), y: rect.bottom - 64 },
      { x: centreX, y: rect.top - 72 },
    ];
    const label = candidates.find(({ x, y }) => y >= 100 && y + 64 <= window.innerHeight - 12 &&
      controls.every((bounds) => x + 130 <= bounds.left - 8 || x - 130 >= bounds.right + 8 ||
        y + 64 <= bounds.top - 8 || y >= bounds.bottom + 8)) || candidates[0];
    const liftY = -2;
    setSpotlight({ spot, liftX, liftY,
      labelX: label.x, labelY: label.y,
    });
  }

  useEffect(() => {
    // Load after hydration, without overwriting a saved cart with the initial empty state.
    const timer = window.setTimeout(() => {
      setCart(readMerchCart());
      cartReady.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!cartReady.current) return;
    try { localStorage.setItem(MERCH_CART_KEY, JSON.stringify(cart)); } catch { /* Cart still works in memory. */ }
  }, [cart]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function addToCart(product: MerchProduct, size: MerchSize, quantity: number) {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id && line.size === size);
      return existing
        ? current.map((line) => line === existing ? { ...line, quantity: Math.min(10, line.quantity + quantity) } : line)
        : [...current, { productId: product.id, size, quantity }];
    });
    setNotice(`${product.name} · ${size} added to your bag`);
    setPanel({ kind: "cart" });
  }

  function changeQuantity(productId: string, size: MerchSize, quantity: number) {
    setCart((current) => current.map((line) => line.productId === productId && line.size === size
      ? { ...line, quantity: Math.min(10, Math.max(0, quantity)) } : line).filter((line) => line.quantity > 0));
  }

  const total = cart.reduce((sum, line) => sum + (MERCH_PRODUCTS.find((p) => p.id === line.productId)?.price || 0) * line.quantity, 0);

  return (
    <div className={`merch-experience${spotlight ? " is-spotlighting" : ""}`}>
      <section className="merch-scene" aria-label="Shop the wardrobe: select a garment">
        {/* The image and all hotspots share one cover-sized plane, including its crop. */}
        <div className="merch-plane">
          <Image src={assets.merchRoom} alt="The Continental wardrobe, with red-and-black varsity jackets, black hoodies, tees, a patterned jersey, and a gorilla-emblem jacket in the centre." fill priority sizes="100vw" className="merch-room-image" />
          {MERCH_HOTSPOTS.map((spot) => {
            const display = MERCH_DISPLAYS[spot.productId];
            const rect = spot.rect;
            const selected = spotlight?.spot.id === spot.id;
            return <button key={spot.id} type="button" className={`merch-hotspot${selected ? " is-active" : ""}`} data-hotspot={spot.id}
              aria-label={`${display.label}. Explore collection; room artwork is illustrative.`}
              aria-haspopup="dialog"
              onPointerEnter={(event) => { if (event.pointerType === "mouse") showSpotlight(spot, event.currentTarget); }}
              onPointerLeave={() => setSpotlight(null)}
              onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) showSpotlight(spot, event.currentTarget); }}
              onBlur={() => setSpotlight(null)}
              onKeyDown={(event) => { if (event.key === "Escape") setSpotlight(null); }}
              onClick={() => { setSpotlight(null); setPanel({ kind: "collection", group: display.group }); }}
              style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`,
                "--lift-x": `${selected ? spotlight.liftX : 0}px`, "--lift-y": `${selected ? spotlight.liftY : 0}px`,
              } as CSSProperties}>
              <span className="merch-garment-lift"><GarmentCutout spot={spot} /></span>
              <span className="merch-pin" aria-hidden="true">+</span>
            </button>;
          })}
        </div>
        <div className="merch-scene-shade" />
      </section>

      {spotlight && <div className="merch-hover-caption" aria-hidden="true" style={{ left: spotlight.labelX, top: spotlight.labelY }}>
        <strong>{MERCH_DISPLAYS[spotlight.spot.productId].label}</strong>
        <span>Explore collection <small>Illustrative room display</small></span>
      </div>}

      <header className="merch-room-caption">
        <p className="merch-eyebrow">The Continental · The wardrobe</p>
        <h1>Wear the signature.</h1>
        <p><span className="merch-desktop-instruction">Hover over a piece. Click to make it yours.</span><span className="merch-touch-instruction">Tap a piece to explore it.</span></p>
        <button className="merch-text-button" onClick={() => setPanel({ kind: "collection" })}>View collection <span aria-hidden="true">↗</span></button>
      </header>

      <div className="merch-shop-tools">
        <span className="merch-preview-label">Shop · Test checkout</span>
        <button className="merch-bag-button" aria-label={`Open shopping bag, ${cartCount} items`} onClick={() => setPanel({ kind: "cart" })}>
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M5 7h14l1 14H4L5 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></svg>
          Your bag <span className="merch-bag-count">{cartCount}</span>
        </button>
      </div>

      <section className="merch-mobile-collection" aria-label="All wardrobe pieces">
        <p className="merch-eyebrow">Explore every piece</p>
        <Collection onSelect={(product) => setPanel({ kind: "product", product })} />
      </section>
      <div className={`merch-toast${notice ? " is-visible" : ""}`} role="status">{notice}</div>

      {panel && <MerchDialog onClose={() => setPanel(null)} title={panel.kind === "product" ? panel.product.name : panel.kind === "cart" ? "Your bag" : "The collection"}>
        {panel.kind === "product" && <ProductDetails key={panel.product.id} product={panel.product} onAdd={addToCart} />}
        {panel.kind === "collection" && <>
          <p className="merch-muted">Nine pieces in the collection. Product photos are coming soon; the room displays are illustrative.</p>
          <Collection group={panel.group} onSelect={(product) => setPanel({ kind: "product", product })} />
          {panel.group && <button className="merch-secondary" onClick={() => setPanel({ kind: "collection" })}>View all nine products</button>}
        </>}
        {panel.kind === "cart" && <>
          {cart.length ? <>
            <div className="merch-cart-lines">
              {cart.map((line) => {
                const product = MERCH_PRODUCTS.find((p) => p.id === line.productId)!;
                return <article className="merch-cart-line" key={`${line.productId}-${line.size}`}>
                  <ProductImage product={product} />
                  <div>
                    <h3>{product.name}</h3>
                    <p className="merch-muted">Size {line.size} · {money(product.price)} USD each</p>
                    <div className="merch-line-actions">
                      <div className="merch-quantity">
                        <button aria-label={`Decrease ${product.name}, size ${line.size}`} onClick={() => changeQuantity(line.productId, line.size, line.quantity - 1)}>−</button>
                        <span>{line.quantity}</span>
                        <button aria-label={`Increase ${product.name}, size ${line.size}`} disabled={line.quantity >= 10} onClick={() => changeQuantity(line.productId, line.size, line.quantity + 1)}>+</button>
                      </div>
                      <button className="merch-remove" aria-label={`Remove ${product.name}, size ${line.size}`} onClick={() => changeQuantity(line.productId, line.size, 0)}>Remove</button>
                    </div>
                  </div>
                  <span className="merch-line-price">{money(product.price * line.quantity)}</span>
                </article>;
              })}
            </div>
            <div className="merch-total"><span>Subtotal</span><strong>{money(total)} USD</strong></div>
            <p className="merch-muted">Shipping is calculated at test checkout. Taxes and stock tracking are not configured.</p>
            <Link className="merch-primary" style={{ display: "block", textAlign: "center", textDecoration: "none" }} href="/merch/checkout">Continue to test checkout</Link>
            <p className="merch-preview-note">Stripe test mode only. No real payment or shipment. No account required.</p>
          </> : <div className="merch-empty"><span aria-hidden="true">✧</span><h3>Your signature starts here.</h3><p className="merch-muted">Explore the wardrobe and add your first piece.</p></div>}
          <button className="merch-secondary" onClick={() => setPanel({ kind: "collection" })}>Continue exploring</button>
        </>}
      </MerchDialog>}
    </div>
  );
}

function Collection({ onSelect, group }: { group?: MerchGroup; onSelect: (product: MerchProduct) => void }) {
  return <div className="merch-collection-grid">
    {MERCH_PRODUCTS.filter((product) => !group || product.group === group).map((product) => <button key={product.id} className="merch-collection-card" onClick={() => onSelect(product)} aria-haspopup="dialog">
      <div className="merch-collection-photo"><ProductImage product={product} /><span aria-hidden="true">↗</span></div>
      <span className="merch-eyebrow">{product.category}</span>
      <strong>{product.name}</strong>
      <span>{money(product.price)} <small>USD</small></span>
    </button>)}
  </div>;
}

function ProductDetails({ product, onAdd }: { product: MerchProduct; onAdd: (product: MerchProduct, size: MerchSize, quantity: number) => void }) {
  const [size, setSize] = useState<MerchSize | null>(null);
  const [quantity, setQuantity] = useState(1);
  return <div className="merch-product-details">
    <div className="merch-detail-photo"><ProductImage product={product} /><span>Product photography coming soon</span></div>
    <p className="merch-eyebrow">{product.category}</p>
    <div className="merch-product-price">{money(product.price)} <small>USD</small></div>
    <p className="merch-description">{product.description}</p>
    <fieldset className="merch-sizes"><legend>Select your size</legend>
      {product.sizes.map((option) => <label key={option}>
        <input type="radio" name="merch-size" value={option} checked={size === option} onChange={() => setSize(option)} />
        <span>{option}</span>
      </label>)}
    </fieldset>
    <div className="merch-quantity-row"><span>Quantity</span><div className="merch-quantity">
      <button aria-label="Decrease quantity" disabled={quantity === 1} onClick={() => setQuantity((value) => value - 1)}>−</button>
      <span>{quantity}</span>
      <button aria-label="Increase quantity" disabled={quantity === 10} onClick={() => setQuantity((value) => value + 1)}>+</button>
    </div></div>
    <button className="merch-primary" disabled={!size} onClick={() => { if (size) onAdd(product, size, quantity); }}>{size ? `Add to bag — ${money(product.price * quantity)}` : "Select a size to add to bag"}</button>
    <p className="merch-preview-note">Test checkout only. Stock is not tracked yet; availability will be confirmed before live sales.</p>
  </div>;
}

function MerchDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    // Product, collection and bag share the drawer; each view starts at its heading.
    if (ref.current) {
      ref.current.scrollTop = 0;
      ref.current.querySelector<HTMLButtonElement>(".merch-close")?.focus({ preventScroll: true });
    }
  }, [title]);
  return <dialog ref={ref} className="merch-dialog" aria-labelledby="merch-dialog-title" onCancel={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="merch-dialog-content">
      <div className="merch-dialog-heading"><div><p className="merch-eyebrow">The Continental wardrobe</p><h2 id="merch-dialog-title">{title}</h2></div>
        <button className="merch-close" aria-label="Close product panel" onClick={onClose} autoFocus>×</button>
      </div>
      {children}
    </div>
  </dialog>;
}
