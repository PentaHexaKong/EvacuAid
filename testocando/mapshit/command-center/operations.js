// Persisted operational workflows; render untrusted report text only with textContent.
export function setupOperations({ map, api, routeLayer, isPlacing }) {
  const $ = id => document.getElementById(id)
  const node = (tag, text) => { const el=document.createElement(tag); el.textContent=text; return el }
  let reportOffset=0, caseOffset=0, routeOffset=0, armed=false, refreshing=false
  const reportLayer=L.layerGroup()
  const button = (label, action) => {
    const el=node('button',label)
    el.onclick=async()=>{ el.disabled=true; try { await action(); await refresh() } catch(error) { $('operations-message').textContent=error.message } finally { el.disabled=false } }
    return el
  }
  const note = () => window.prompt('Review / action note (public operational text; exclude personal information):')
  function row(title, body) { const el=node('article',''); el.className='operation-row'; el.append(node('strong',title),node('p',body)); return el }
  async function refresh() {
    if (refreshing || document.hidden) return
    if ($('dataMode').value === 'SIMULATION') { $('operations-content').hidden=true; $('operations-message').textContent='SIMULATION: live cases and route publishing are hidden.'; routeLayer.clearLayers(); reportLayer.clearLayers(); return }
    $('operations-content').hidden=false
    refreshing=true
    try {
      const [reports,cases,checkins,routes] = await Promise.all([
        api('operations/reports?limit=50&offset='+reportOffset),api('operations/assistance?limit=50&offset='+caseOffset),
        api('operations/check-ins'),api('operations/routes?limit=50&offset='+routeOffset)])
      $('operations-message').textContent='Connected · last received '+new Date().toLocaleString()+'. Observations may be delayed. No live shelter occupancy is tracked.'
      $('field-report-list').replaceChildren()
      reportLayer.clearLayers()
      for(const report of reports) {
        const el=row(report.kind+' · '+report.status,report.description+' · observed '+report.observedAt+' · received '+report.createdAt+(report.review.note?' · '+report.review.note:''))
        el.append(button('Show location',()=>{ map.setView([report.latitude,report.longitude],16); L.circleMarker([report.latitude,report.longitude],{radius:8,color:report.status==='CONFIRMED'?'#c63f4e':'#277ac0'}).bindTooltip(node('span',report.kind+' · '+report.status)).addTo(reportLayer); reportLayer.addTo(map) }))
        for(const status of ['CONFIRMED','REJECTED','RESOLVED']) el.append(button(status,async()=>{
          const reviewNote=note(); if(!reviewNote) return
          let barrier=false, radiusM=30,validUntil=null
          if(status==='CONFIRMED' && report.kind!=='SHELTER_CROWDING') {
            barrier=window.confirm('Have responders verified that this location is a hard evacuation barrier? This will invalidate published routes.')
            if(barrier) { radiusM=Number(window.prompt('Confirmed barrier radius in metres (5–2000):','30')); const hours=Number(window.prompt('Validity in hours (greater than 0, maximum 24):','2')); if(!Number.isFinite(hours)||hours<=0||hours>24) throw new Error('Invalid evidence duration'); validUntil=new Date(Date.now()+hours*3600000).toISOString() }
          }
          await api('operations/reports/'+report.id,{method:'PATCH',body:JSON.stringify({status,note:reviewNote,expectedUpdatedAt:report.updatedAt,barrier,radiusM,validUntil})})
        }))
        $('field-report-list').append(el)
      }
      if(!reports.length) $('field-report-list').append(node('p','No field reports on this page.'))
      $('assistance-case-list').replaceChildren()
      for(const item of cases) {
        const el=row('Case '+item.requestId.slice(0,8)+' · '+item.status,(item.supportNeeds.join(', ')||'No needs reported')+' · updated '+item.observedAt+(item.stale?' · STALE':'')+' · Government action: '+(item.government?.status||'Unassigned')+(item.government?.note?' · '+item.government.note:''))
        for(const status of ['ACKNOWLEDGED','DISPATCHED','COMPLETED','CANCELLED']) el.append(button(status,async()=>{ const value=note(); if(value) await api('operations/assistance/'+item.requestId,{method:'PATCH',body:JSON.stringify({status,note:value,expectedUpdatedAt:item.caseUpdatedAt,assignedRouteId:status==='DISPATCHED'?(item.government?.assignedRouteId||null):null})}) }))
        const availableRoutes=routes.filter(route=>route.usable)
        const select=node('select',''); select.setAttribute('aria-label','Assign published route to case '+item.requestId.slice(0,8));select.append(new Option('Choose published route',''))
        for(const route of availableRoutes) select.append(new Option(route.name,route.id))
        el.append(select,button('Assign route / dispatch',async()=>{ if(!select.value) throw new Error('Choose a current published route'); const value=note();if(value) await api('operations/assistance/'+item.requestId,{method:'PATCH',body:JSON.stringify({status:'DISPATCHED',note:value,expectedUpdatedAt:item.caseUpdatedAt,assignedRouteId:select.value})}) }))
        $('assistance-case-list').append(el)
      }
      if(!cases.length) $('assistance-case-list').append(node('p','No assistance requests on this page.'))
      $('evacuation-check-ins').replaceChildren(node('p',checkins.scope))
      for(const group of checkins.regions) $('evacuation-check-ins').append(node('p',group.regionId+' · '+group.status+': '+group.count+' · latest observation '+group.lastObservedAt))
      $('operational-route-list').replaceChildren(); routeLayer.clearLayers()
      for(const route of routes) {
        const result=route.result
        const el=row(route.name+' · '+route.status+(route.stale?' · EXPIRED':''), (result.shelterName||'Shelter')+' · '+result.routeStatus+' · '+(result.selectionReasonCodes||[]).join(', ')+' · expires '+route.expiresAt+' · Safety not verified')
        if(result.route?.geometry) {
          el.append(button('Show evaluated geometry',()=>{ const layer=L.geoJSON(result.route.geometry,{style:{color:route.usable?'#176d60':'#82929e',dashArray:route.usable?null:'5 5'}}).addTo(routeLayer); routeLayer.addTo(map); map.fitBounds(layer.getBounds()) }))
          if(route.usable) L.geoJSON(result.route.geometry,{style:{color:'#176d60'}}).bindTooltip(node('span',route.name+' · expires '+route.expiresAt+' · safety not verified')).addTo(routeLayer)
        }
        el.append(button('Edit / recalculate',async()=>{ setRegion(await api('regions/'+route.regionId)); $('route-id').value=route.id; $('route-name').value=route.name; $('route-shelter-id').value=route.shelterId; $('route-origin-lat').value=route.originLatitude; $('route-origin-lon').value=route.originLongitude; $('route-step-free').checked=route.mobilityRequired; $('route-form').scrollIntoView({behavior:'smooth'}) }),
          button('Revalidate and publish',async()=>{ if($('mock-mode').checked) throw new Error('Disable mock mode before publishing operational routes'); await api('operations/routes/'+route.id+'/publish',{method:'POST'}) }),
          button('Withdraw',async()=>{ await api('operations/routes/'+route.id+'/withdraw',{method:'POST'}) }))
        $('operational-route-list').append(el)
      }
      if(!routes.length) $('operational-route-list').append(node('p','No Route Setter drafts on this page.'))
    } catch(error) { $('operations-message').textContent='Connection unavailable · retained data may be stale. '+error.message }
    finally { refreshing=false }
  }
  $('operations-refresh').onclick=refresh
  for(const [prefix,get,set] of [['reports',()=>reportOffset,v=>reportOffset=v],['cases',()=>caseOffset,v=>caseOffset=v],['routes',()=>routeOffset,v=>routeOffset=v]]) {
    $(prefix+'-previous').onclick=()=>{set(Math.max(0,get()-50));void refresh()}
    $(prefix+'-next').onclick=()=>{set(get()+50);void refresh()}
  }
  $('route-pick-origin').onclick=()=>{armed=true;$('route-feedback').textContent='Click a public evacuation assembly point on the map.'}
  map.on('click',event=>{ if(!armed || isPlacing()) return; armed=false; $('route-origin-lat').value=event.latlng.lat; $('route-origin-lon').value=event.latlng.lng;$('route-feedback').textContent='Origin selected. Choose a recorded shelter and calculate.' })
  $('route-new').onclick=()=>{ const regionId=$('route-region-id').value; $('route-form').reset(); $('route-region-id').value=regionId; $('route-id').value=''; armed=false }
  $('route-form').onsubmit=async event=>{
    event.preventDefault(); $('route-calculate').disabled=true
    try {
      if($('mock-mode').checked) throw new Error('Disable mock mode before calculating operational routes')
      const id=$('route-id').value||crypto.randomUUID(); $('route-id').value=id
      const payload={id,name:$('route-name').value.trim(),regionId:$('route-region-id').value,shelterId:$('route-shelter-id').value,originLatitude:Number($('route-origin-lat').value),originLongitude:Number($('route-origin-lon').value),mobilityRequired:$('route-step-free').checked}
      const route=await api('operations/routes',{method:'POST',body:JSON.stringify(payload)})
      $('route-feedback').textContent='Draft saved · '+route.result.routeStatus+' · '+(route.result.selectionReasonCodes||[]).join(', ')+'. Publish re-evaluates current evidence.'
      await refresh()
    } catch(error) { $('route-feedback').textContent=error.message }
    finally {$('route-calculate').disabled=false}
  }
  $('dataMode').addEventListener('change',refresh)
  const timer=setInterval(refresh,15000)
  window.addEventListener('beforeunload',()=>clearInterval(timer))
  void refresh()
  function setRegion(detail) {
    if(!detail || detail.dataMode!=='REFERENCE') return
    const sameRegion=$('route-region-id').value===detail.id
    const selected=sameRegion ? $('route-shelter-id').value : ''
    if(!sameRegion) $('route-id').value=''
    $('route-region-id').value=detail.id; $('route-region-label').textContent=detail.name
    $('route-shelter-id').replaceChildren(new Option('Choose shelter',''))
    for(const shelter of detail.shelters) $('route-shelter-id').append(new Option(shelter.name+' · reference capacity '+(shelter.capacity??'unknown')+' · step-free '+(shelter.wheelchairAccessible??'unknown'),shelter.id))
    if(detail.shelters.some(shelter=>shelter.id===selected)) $('route-shelter-id').value=selected
  }
  return { refresh, setRegion }
}
