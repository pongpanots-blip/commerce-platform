import { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Icon, fmt } from '@cp/ui';
import type { RestaurantRow } from '../../lib/api';

export function hasRestaurantCoordinates(r: Pick<RestaurantRow, 'lat' | 'lng'>) {
  return Number.isFinite(r.lat) && Number.isFinite(r.lng) && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180 && (r.lat !== 0 || r.lng !== 0);
}

export function RestaurantMap({ restaurants, page, total, onSelect }: {
  restaurants: RestaurantRow[]; page: number; total: number; onSelect: (restaurant: RestaurantRow) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const places = useMemo(() => restaurants.filter(hasRestaurantCoordinates), [restaurants]);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    if (!canvas.current || !places.length) return;
    setTileError(false);
    const map = L.map(canvas.current, { scrollWheelZoom: false, zoomControl: false });
    L.control.zoom({ zoomInTitle: 'ซูมเข้า', zoomOutTitle: 'ซูมออก' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).on('tileerror', () => setTileError(true)).addTo(map);

    for (const [index, restaurant] of places.entries()) {
      const label = document.createElement('span');
      label.textContent = restaurant.name || 'ยังไม่มีชื่อร้าน';
      L.marker([restaurant.lat, restaurant.lng], {
        title: `ดูรายละเอียด ${restaurant.name || 'ยังไม่มีชื่อร้าน'}`,
        keyboard: true,
        icon: L.divIcon({
          className: `market-map-pin${restaurant.winbackAccountId ? ' is-linked' : ''}`,
          html: String(index + 1), iconSize: [32, 32], iconAnchor: [16, 16],
        }),
      }).bindTooltip(label, { direction: 'top', offset: [0, -18] })
        .on('add', event => event.target.getElement()?.setAttribute('aria-label', `ดูรายละเอียด ${restaurant.name || 'ยังไม่มีชื่อร้าน'}`))
        .on('click', () => onSelect(restaurant))
        .on('keydown', (event: L.LeafletKeyboardEvent) => {
          if (event.originalEvent.key === 'Enter' || event.originalEvent.key === ' ') {
            L.DomEvent.stop(event.originalEvent);
            onSelect(restaurant);
          }
        }).addTo(map);
    }
    map.fitBounds(L.latLngBounds(places.map(r => L.latLng(r.lat, r.lng))), { padding: [32, 32], maxZoom: 15 });
    return () => { map.remove(); };
  }, [places, onSelect]);

  return <section className="market-map" aria-label="แผนที่ร้านในผลค้นหา">
    <div className="market-map-head">
      <div><h2><Icon name="map" size={20} /> แผนที่ร้านในหน้านี้</h2>
        <p>แสดง {places.length} จาก {restaurants.length} ร้านในหน้า {page} · ผลค้นหาทั้งหมด {fmt.num(total)} ร้าน</p></div>
      <div className="market-map-legend"><span><i /> ยังไม่มีฝ่ายขาย</span><span><i className="is-linked" /> มีในรายชื่อแล้ว</span></div>
    </div>
    {places.length ? <>
      <div ref={canvas} className="market-map-canvas" role="region" aria-label="แผนที่ร้านอาหาร เลื่อนด้วยปุ่มลูกศร ซูมด้วยปุ่มบวกหรือลบ และกดหมุดเพื่อดูรายละเอียด" />
      {tileError && <p role="status" className="market-map-note">พื้นแผนที่บางส่วนโหลดไม่ได้ ยังเปิดรายละเอียดจากหมุดหรือรายชื่อร้านได้</p>}
      <p className="market-map-note">กดหมุดเพื่อดูรายละเอียด · เปลี่ยนหน้ารายชื่อหรือตัวกรองเพื่อดูร้านกลุ่มถัดไป{places.length < restaurants.length && ` · อีก ${restaurants.length - places.length} ร้านยังไม่มีพิกัดที่ใช้แสดงได้`}</p>
    </> : <div className="market-map-empty"><Icon name="location_off" size={28} /><p>ร้านในหน้านี้ยังไม่มีพิกัดที่ใช้แสดงแผนที่</p></div>}
  </section>;
}
