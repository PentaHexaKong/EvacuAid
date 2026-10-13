// Persisted operational workflows; render untrusted report text only with textContent.
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
function label(value) {
  const text = String(value ?? 'Unknown').toLowerCase().replaceAll('_', ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
function ago(iso) {
  if (!iso) return 'Unknown'
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  if (!Number.isFinite(seconds)) return 'Unknown'
  for (const [unit, size] of [['year',31536000],['month',2592000],['day',86400],['hour',3600],['minute',60],['second',1]]) {
    if (Math.abs(seconds) >= size || unit === 'second') return relativeTime.format(Math.round(seconds / size), unit)
  }
}
export function setupOperations({ map, api, routeLayer, isPlacing }) {
  const $ = id => document.getElementById(id)
  const node = (tag, text) => { const el=document.createElement(tag); el.textContent=text; return el }
  const option = (text, value) => { const el=node('option',text); el.value=value; return el }
  const styles = getComputedStyle(document.documentElement)
  const colors = Object.fromEntries(['critical-stroke','normal-stroke','route-usable','route-unusable'].map(name => [name,styles.getPropertyValue('--'+name).trim()]))
  let reportOffset=0, caseOffset=0, routeOffset=0, armed=false, refreshing=false
  const reportLayer=L.layerGroup()
  const dialog = $('ops-dialog')
  function askOps({title, context, minNote, barrier, routes, submitLabel}) {
    const trigger = document.activeElement
    const form = $('ops-dialog-form')
    form.reset()
    $('ops-dialog-title').textContent=title
    $('ops-dialog-context').textContent=context
    $('ops-note').minLength=minNote
    $('ops-note-count').textContent='0/500'
    $('ops-dialog-error').textContent=''
    $('ops-dialog-submit').textContent=submitLabel
    $('ops-barrier').hidden=!barrier
    const updateBarrier = () => {
      const enabled=barrier && $('ops-hard-barrier').checked
      $('ops-barrier-fields').hidden=!enabled
      $('ops-radius').disabled=!enabled
      $('ops-hours').disabled=!enabled
    }
    updateBarrier()
    $('ops-hard-barrier').onchange=updateBarrier
    $('ops-route-field').hidden=routes === null
    $('ops-route-select').disabled=routes === null
    $('ops-route-select').required=false
    $('ops-route-select').replaceChildren(new Option('Choose published route',''))
    for (const route of routes || []) $('ops-route-select').append(option(route.name,route.id))
    $('ops-note').oninput=()=>{ $('ops-note-count').textContent=$('ops-note').value.length+'/500' }
    return new Promise(resolve => {
      let result=null
      const showValidationError=event=>{ $('ops-dialog-error').textContent=event.target.validationMessage }
      form.addEventListener('invalid', showValidationError, true)
      const finish=()=>{
        form.removeEventListener('invalid', showValidationError, true)
        trigger?.focus({preventScroll:true})
        resolve(result)
      }
      dialog.addEventListener('close',finish,{once:true})
      dialog.oncancel=event=>{ event.preventDefault(); dialog.close() }
      $('ops-dialog-cancel').onclick=()=>dialog.close()
      form.onsubmit=event=>{
        event.preventDefault()
        $('ops-dialog-error').textContent=''
        if (!form.reportValidity()) return
        const note=$('ops-note').value.trim()
        const hardBarrier=barrier && $('ops-hard-barrier').checked
        const radiusM=hardBarrier ? Number($('ops-radius').value) : 30
        const hours=Number($('ops-hours').value)
        if (note.length < minNote || note.length > 500) { $('ops-dialog-error').textContent='Enter a note of '+minNote+'–500 characters.'; $('ops-note').focus(); return }
        if (hardBarrier && (!Number.isFinite(radiusM) || radiusM < 5 || radiusM > 2000 || !Number.isFinite(hours) || hours <= 0 || hours > 24)) { $('ops-dialog-error').textContent='Use a radius of 5–2000 metres and a validity greater than 0 and at most 24 hours.'; return }
        const assignedRouteId=routes === null ? null : $('ops-route-select').value || null
        if (assignedRouteId && !routes.some(route=>route.id===assignedRouteId && route.usable)) { $('ops-dialog-error').textContent='Choose a current published route.'; return }
        result={note,barrier:hardBarrier,radiusM,validUntil:hardBarrier ? new Date(Date.now()+hours*3600000).toISOString() : null,assignedRouteId}
        dialog.close()
      }
      dialog.showModal()
      $('ops-note').focus()
    })
  }
  const button = (text, action, primary=false) => {
    const el=node('button',text)
    el.type='button'
    el.className='btn-sm'+(primary?' primary':'')
    let pending=false
    el.onclick=async()=>{
      if (pending) return
      pending=true
      el.focus({preventScroll:true})
      el.setAttribute('aria-disabled','true')
      try {
        const confirmation=await action()
        if (confirmation === null) return
        const returnFocus=document.activeElement === el
        const key=el.closest('.ops-row')?.dataset.opsKey
        await refresh()
        if (returnFocus && key) {
          const replacement=[...document.querySelectorAll('.ops-row')].find(row=>row.dataset.opsKey===key)
          const target=[...(replacement?.querySelectorAll('button') || [])].find(button=>button.textContent===text)
          if (target) {
            const disclosure=target.closest('details')
            if (disclosure) disclosure.open=true
            const older=target.closest('.ops-older')
            if (older) older.open=true
            target.focus({preventScroll:true})
          } else replacement?.querySelector('summary')?.focus({preventScroll:true})
        }
        if (confirmation) $('operations-message').textContent=confirmation
      } catch(error) { $('operations-message').textContent='Could not save: '+error.message }
      finally { pending=false; el.removeAttribute('aria-disabled') }
    }
    return el
  }
  function time(iso) {
    const el=node('time',ago(iso))
    if (iso) { el.dateTime=iso; el.title=new Date(iso).toLocaleString() }
    return el
  }
  function timed(prefix,iso) { const el=node('span',prefix); el.append(time(iso)); return el }
  function meta(el,parts) {
    const line=node('div',''); line.className='ops-meta'
    for (const part of parts.filter(part=>part !== null && part !== undefined && part !== '')) {
      if (line.childNodes.length) line.append(document.createTextNode(' · '))
      line.append(typeof part === 'string' ? node('span',part) : part)
    }
    el.append(line)
  }
  function row(title,status,stale=false,usable=false) {
    const el=node('li',''); el.className='ops-row'
    const top=node('div',''); top.className='ops-row-top'
    const chip=node('span',label(status)+(stale?' · Stale':''))
    const tone=stale?'unknown':usable || ['RESOLVED','COMPLETED','ARRIVED','SAFE_REPORTED','PUBLISHED'].includes(status)?'normal':['CONFIRMED','NEEDS_ASSISTANCE','UNANSWERED','INTERRUPTED'].includes(status)?'critical':['DISPATCHED','EVACUATING','ACKNOWLEDGED'].includes(status)?'elevated':'unknown'
    chip.className='badge is-'+tone
    top.append(node('strong',title),chip); el.append(top)
    return el
  }
  function actions(el) { const line=node('div',''); line.className='ops-actions'; el.append(line); return line }
  function more(el) {
    const details=node('details',''); details.className='row-more'
    details.append(node('summary','More actions'))
    const line=node('div',''); line.className='row-more-actions'; details.append(line); (el.querySelector('.ops-actions') || actions(el)).append(details); return line
  }
  function list(container,items,empty) {
    container.replaceChildren()
    if (!items.length) { const el=node('p',empty); el.className='ops-empty'; container.append(el); return }
    const ul=node('ul',''); ul.className='ops-list'; ul.setAttribute('role','list'); ul.append(...items); container.append(ul)
  }
  async function refresh() {
    if (refreshing || dialog.open) return
    if ($('dataMode').value === 'SIMULATION') { $('operations-content').hidden=true; $('operations-message').textContent='SIMULATION: live cases and route publishing are hidden.'; routeLayer.clearLayers(); reportLayer.clearLayers(); return }
    $('operations-content').hidden=false
    refreshing=true
    try {
      const [reports,cases,checkins,routes] = await Promise.all([
        api('operations/reports?limit=50&offset='+reportOffset),api('operations/assistance?limit=50&offset='+caseOffset),
        api('operations/check-ins'),api('operations/routes?limit=50&offset='+routeOffset)])
      if (dialog.open) return
      // Re-rendering replaces every row; keep what the operator had expanded.
      const openMenus=new Set([...document.querySelectorAll('.ops-row .row-more[open]')].map(d=>d.closest('.ops-row').dataset.opsKey))
      const olderOpen=Boolean(document.querySelector('.ops-older[open]'))
      if ($('dataMode').value === 'SIMULATION') { $('operations-content').hidden=true; $('operations-message').textContent='SIMULATION: live cases and route publishing are hidden.'; routeLayer.clearLayers(); reportLayer.clearLayers(); return }
      $('operations-message').replaceChildren(document.createTextNode('Connected · last received '),time(new Date().toISOString()),document.createTextNode('. Observations may be delayed. No live shelter occupancy is tracked.'))
      reportLayer.clearLayers()
      const reportRows=reports.map(report=>{
        const el=row(label(report.kind),report.status,report.stale)
        el.dataset.opsKey='report:'+report.id
        const description=node('span',report.description); description.className='ops-description'; description.title=report.description
        meta(el,[description,timed('observed ',report.observedAt),timed('received ',report.createdAt),report.review.note])
        const saveReport=status=>async()=>{
          const submitLabel={CONFIRMED:'Confirm report',REJECTED:'Reject report',RESOLVED:'Mark resolved'}[status]
          const value=await askOps({title:submitLabel,context:label(report.kind)+': '+report.description,minNote:5,barrier:status==='CONFIRMED' && report.kind!=='SHELTER_CROWDING',routes:null,submitLabel})
          if (!value) return null
          const {note,barrier,radiusM,validUntil}=value
          await api('operations/reports/'+report.id,{method:'PATCH',body:JSON.stringify({status,note,expectedUpdatedAt:report.updatedAt,barrier,radiusM,validUntil})})
          return 'Report '+{CONFIRMED:'confirmed',REJECTED:'rejected',RESOLVED:'resolved'}[status]+'.'
        }
        actions(el).append(button('Confirm',saveReport('CONFIRMED'),true),button('Show on map',async()=>{ location.hash = '#overview'; await new Promise(requestAnimationFrame); map.invalidateSize(); map.setView([report.latitude,report.longitude],16); L.circleMarker([report.latitude,report.longitude],{radius:8,color:report.status==='CONFIRMED'?colors['critical-stroke']:colors['normal-stroke']}).bindTooltip(node('span',label(report.kind)+' · '+label(report.status))).addTo(reportLayer); reportLayer.addTo(map) }))
        more(el).append(button('Reject',saveReport('REJECTED')),button('Mark resolved',saveReport('RESOLVED')))
        return el
      })
      list($('field-report-list'),reportRows,'No field reports to review. New public reports appear here within 15 seconds.')
      const availableRoutes=routes.filter(route=>route.usable)
      const fresh=[],older=[]
      for(const item of cases) {
        const id=item.requestId.slice(0,8)
        const el=row('Case '+id,item.status,item.stale)
        el.dataset.opsKey='case:'+item.requestId
        meta(el,[(item.supportNeeds.map(label).join(', ')||'No needs reported'),timed('updated ',item.observedAt),'Government action: '+(item.government?.status ? label(item.government.status) : 'Unassigned'),item.government?.note])
        const stepLabels={ACKNOWLEDGED:'Acknowledge',DISPATCHED:'Dispatch',COMPLETED:'Mark completed',CANCELLED:'Cancel'}
        const next={ACKNOWLEDGED:'DISPATCHED',DISPATCHED:'COMPLETED',COMPLETED:null,CANCELLED:null}[item.government?.status] ?? (item.government?.status ? null : 'ACKNOWLEDGED')
        const saveCase=(status,selectedRoute=null)=>async()=>{
          if (selectedRoute !== null && !selectedRoute.value) throw new Error('Choose a current published route')
          const valuePromise=askOps({title:stepLabels[status]+' case '+id,context:(item.supportNeeds.map(label).join(', ')||'No needs reported')+' · Government action: '+(item.government?.status ? label(item.government.status) : 'Unassigned'),minNote:3,barrier:false,routes:status==='DISPATCHED'?availableRoutes:null,submitLabel:stepLabels[status]})
          if (status==='DISPATCHED') $('ops-route-select').value=selectedRoute?.value || item.government?.assignedRouteId || ''
          if (selectedRoute !== null) $('ops-route-select').required=true
          else $('ops-route-select').required=false
          const value=await valuePromise
          if (!value) return null
          await api('operations/assistance/'+item.requestId,{method:'PATCH',body:JSON.stringify({status,note:value.note,expectedUpdatedAt:item.caseUpdatedAt,assignedRouteId:status==='DISPATCHED'?(value.assignedRouteId||item.government?.assignedRouteId||null):null})})
          return 'Case '+id+' '+{ACKNOWLEDGED:'acknowledged',DISPATCHED:'dispatched',COMPLETED:'completed',CANCELLED:'cancelled'}[status]+'.'
        }
        if (next) actions(el).append(button(stepLabels[next],saveCase(next),true))
        const extra=more(el)
        for(const status of ['ACKNOWLEDGED','DISPATCHED','COMPLETED','CANCELLED']) if (status!==next) extra.append(button(stepLabels[status],saveCase(status)))
        const select=node('select',''); select.setAttribute('aria-label','Assign published route to case '+id); select.append(new Option('Choose published route',''))
        for(const route of availableRoutes) select.append(option(route.name,route.id))
        extra.append(select,button('Assign route and dispatch',saveCase('DISPATCHED',select)))
        ;(item.stale?older:fresh).push(el)
      }
      list($('assistance-case-list'),fresh,older.length?'No assistance requests in the last 24 hours.':'No open assistance requests.')
      if (older.length) {
        const details=node('details',''); details.className='ops-older'; details.open=olderOpen; details.append(node('summary','Older than 24 hours ('+older.length+')'))
        const ul=node('ul',''); ul.className='ops-list'; ul.setAttribute('role','list'); ul.append(...older); details.append(ul); $('assistance-case-list').append(details)
      }
      $('ops-checkins-scope').textContent=checkins.scope
      list($('evacuation-check-ins'),checkins.regions.map(group=>{
        const el=row(group.regionId,group.status)
        const latest=node('span',group.count+' people · latest '); latest.append(time(group.lastObservedAt)); meta(el,[latest]); return el
      }),'No check-ins in the last 24 hours.')
      routeLayer.clearLayers()
      const routeRows=routes.map(route=>{
        const result=route.result
        const el=row(route.name,route.status,route.stale,route.usable)
        el.dataset.opsKey='route:'+route.id
        meta(el,[result.shelterName||'Shelter',label(result.routeStatus),timed('expires ',route.expiresAt),'Safety not verified'])
        const line=actions(el)
        if(result.route?.geometry) {
          line.append(button('Show evaluated geometry',async()=>{ location.hash = '#overview'; await new Promise(requestAnimationFrame); map.invalidateSize(); const layer=L.geoJSON(result.route.geometry,{style:{color:route.usable?colors['route-usable']:colors['route-unusable'],dashArray:route.usable?null:'5 5'}}).addTo(routeLayer); routeLayer.addTo(map); map.fitBounds(layer.getBounds()) }))
          if(route.usable) { const tooltip=node('span',route.name+' · expires '); tooltip.append(time(route.expiresAt),document.createTextNode(' · safety not verified')); L.geoJSON(result.route.geometry,{style:{color:colors['route-usable']}}).bindTooltip(tooltip).addTo(routeLayer) }
        }
        line.append(button('Edit / recalculate',async()=>{ setRegion(await api('regions/'+route.regionId)); $('route-id').value=route.id; $('route-name').value=route.name; $('route-shelter-id').value=route.shelterId; $('route-origin-lat').value=route.originLatitude; $('route-origin-lon').value=route.originLongitude; $('route-step-free').checked=route.mobilityRequired; $('route-form').scrollIntoView({behavior:'smooth'}) }),
          button('Revalidate and publish',async()=>{ if($('mock-mode').checked) throw new Error('Disable mock mode before publishing operational routes'); await api('operations/routes/'+route.id+'/publish',{method:'POST'}); return 'Route published.' }),
          button('Withdraw',async()=>{ await api('operations/routes/'+route.id+'/withdraw',{method:'POST'}); return 'Route withdrawn.' }))
        return el
      })
      for(const row of document.querySelectorAll('.ops-row')) if(openMenus.has(row.dataset.opsKey)) { const menu=row.querySelector('.row-more'); if(menu) menu.open=true }
      for(const [prefix,offset,count] of [['reports',reportOffset,reports.length],['cases',caseOffset,cases.length],['routes',routeOffset,routes.length]]) {
        $(prefix+'-previous').disabled=offset===0; $(prefix+'-next').disabled=count<50
        $(prefix+'-previous').parentElement.hidden=offset===0 && count<50
      }
      list($('operational-route-list'),routeRows,'No routes yet. Select a region on the overview map, then calculate a draft below.')
    } catch(error) { $('operations-message').textContent='Connection unavailable · retained data may be stale. '+error.message }
    finally { refreshing=false }
  }
  $('operations-refresh').onclick=refresh
  for(const [prefix,get,set] of [['reports',()=>reportOffset,v=>reportOffset=v],['cases',()=>caseOffset,v=>caseOffset=v],['routes',()=>routeOffset,v=>routeOffset=v]]) {
    $(prefix+'-previous').onclick=()=>{set(Math.max(0,get()-50));void refresh()}
    $(prefix+'-next').onclick=()=>{set(get()+50);void refresh()}
  }
  $('route-pick-origin').onclick=()=>{location.hash = '#overview';armed=true;$('route-feedback').textContent='Click a public evacuation assembly point on the map.'}
  map.on('click',event=>{ if(!armed || isPlacing()) return; armed=false; $('route-origin-lat').value=event.latlng.lat; $('route-origin-lon').value=event.latlng.lng;$('route-feedback').textContent='Origin selected. Choose a recorded shelter and calculate.' })
  $('route-new').onclick=()=>{ const regionId=$('route-region-id').value; $('route-form').reset(); $('route-region-id').value=regionId; $('route-id').value=''; armed=false }
  $('route-form').onsubmit=async event=>{
    event.preventDefault(); $('route-calculate').disabled=true
    try {
      if($('mock-mode').checked) throw new Error('Disable mock mode before calculating operational routes')
      const id=$('route-id').value||crypto.randomUUID(); $('route-id').value=id
      const payload={id,name:$('route-name').value.trim(),regionId:$('route-region-id').value,shelterId:$('route-shelter-id').value,originLatitude:Number($('route-origin-lat').value),originLongitude:Number($('route-origin-lon').value),mobilityRequired:$('route-step-free').checked}
      const route=await api('operations/routes',{method:'POST',body:JSON.stringify(payload)})
      $('route-feedback').textContent='Draft saved · '+label(route.result.routeStatus)+' · '+(route.result.selectionReasonCodes||[]).map(label).join(', ')+'. Publish re-evaluates current evidence.'
      await refresh()
    } catch(error) { $('route-feedback').textContent=error.message }
    finally {$('route-calculate').disabled=false}
  }
  $('dataMode').addEventListener('change',refresh)
  // Background tabs skip the poll, never the first load or explicit refreshes.
  const timer=setInterval(()=>{ if(!document.hidden) refresh() },15000)
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) refresh() })
  window.addEventListener('beforeunload',()=>clearInterval(timer))
  void refresh()
  function setRegion(detail) {
    if(!detail || detail.dataMode!=='REFERENCE') return
    const sameRegion=$('route-region-id').value===detail.id
    const selected=sameRegion ? $('route-shelter-id').value : ''
    if(!sameRegion) $('route-id').value=''
    $('route-region-id').value=detail.id; $('route-region-label').textContent=detail.name
    $('route-shelter-id').replaceChildren(new Option('Choose shelter',''))
    for(const shelter of detail.shelters) $('route-shelter-id').append(option(shelter.name+' · reference capacity '+(shelter.capacity??'unknown')+' · step-free '+(shelter.wheelchairAccessible??'unknown'),shelter.id))
    if(detail.shelters.some(shelter=>shelter.id===selected)) $('route-shelter-id').value=selected
  }
  return { refresh, setRegion }
}
