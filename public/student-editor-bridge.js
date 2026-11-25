(async function () {
  const parentOrigin = new URL(document.referrer).origin;
  const grading = new URLSearchParams(location.search).has('grading');
  const emit = (data) => parent.postMessage(data, parentOrigin);
  try {
    // wait for openIn to finish so the blank role dont overwrite classroom work
    let loaded;
    const initialized=new Promise(resolve=>{loaded=resolve});
    const originalStartup=IDE_Morph.prototype.interpretUrlAnchors;
    IDE_Morph.prototype.interpretUrlAnchors=async function(...args) {
      try {return await originalStartup.apply(this,args)} finally {loaded()}
    };
    NetsBloxMorph.prototype.setQueryString=function() {};
    if (grading) {
      WebSocketManager.prototype._connectWebSocket = function () {
        this.websocket = { readyState: 1, CONNECTING: 0, OPEN: 1, close() {}, send() {} };
      };
      NetsBloxMorph.prototype.newProject = async function () {
        SnapActions.isLeader = true;
        this.createRoom();
        await SnapActions.openProject();
      };
      getConfiguration = async () => ({
        clientId: '_netsblox' + crypto.randomUUID(),
        username: null,
        servicesHosts: [{ url: 'https://services.netsblox.org', categories: [] }],
        cloudUrl: 'https://cloud.netsblox.org',
      });
    }
    await startEnvironment('https://cloud.netsblox.org');
    await initialized;
    const ide = world.children.find(child => child instanceof IDE_Morph);
    const actions = SnapActions;
    ide.setQueryString = function () {}; // wrapper own navigation since an opaque frame cannot change parent history
    let sharing = false, applying = false, enabled = false, blocked = false, readOnly = false;
    let actor = '', version = -1, outstanding = null;
    const deviceControls=installClassroomDeviceControls(ide,emit,parentOrigin,()=>enabled&&!readOnly&&!blocked);
    actions.requestMissingActions = async function () {}; // ordered actions comes from the classroom server
    const originalOpen = actions.openProject.bind(actions);
    actions.openProject = function(xml) {
      if ((sharing || readOnly) && !applying) return Promise.reject(new Error('Shared projects cannot be replaced from this editor. Ask your teacher to create a new group.'));
      return originalOpen(xml);
    };
    const originalSubmit = actions.submitAction.bind(actions);
    const originalAllowed = actions.submitIfAllowed.bind(actions);
    actions.submitIfAllowed = function (event) {
      if (!sharing && !readOnly) return originalAllowed(event);
      return this.submitAction(event);
    };
    actions.submitAction = function (event) {
      if (readOnly && !applying) {
        if (this.isUserAction(event)) return originalSubmit(event);
        this.onActionReject(event,'This is a read-only classroom view.');return;
      }
      if (blocked && !applying) {this.onActionReject(event,'The starter is still loading. Try again when it is ready.');return}
      if (!sharing || applying) return originalSubmit(event);
      if (this.isUserAction(event)) return;
      if (!enabled || outstanding) {
        this.onActionReject(event, enabled ? 'Another edit is still saving. Try again.' : 'Waiting for the shared editor to reconnect.');
        return;
      }
      event.user = actor;
      event.id = version + 1;
      event.username = actor;
      outstanding = event;
      emit({type:'classroom-edit',action:event,version});
    };
    const waitIdle = async () => {
      for (let i=0; actions.isApplyingAction && i<200; i++) await new Promise(r=>setTimeout(r,25));
      if (actions.isApplyingAction) throw new Error('The shared editor could not finish an edit. Reconnect it.');
    };
    addEventListener('message', async event => {
      if (event.source !== parent || event.origin !== parentOrigin) return;
      const data = event.data;
      if (!data || typeof data !== 'object' || !data.type?.startsWith('classroom-')) return;
      try {
        if (data.type === 'classroom-test-reporter' && grading) {
          await waitIdle();
          const spec = data.spec.trim();
          const definitions = ide.stage.globalBlocks.filter(block => block.spec === spec);
          if (definitions.length !== 1) throw new Error('Expected one global custom block with spec: ' + spec);
          const block = definitions[0].blockInstance();
          if (!(block instanceof ReporterBlockMorph)) throw new Error('The tested block must be a reporter or predicate.');
          const inputs = data.inputs;
          const proc = new Process();
          const context = proc.reify(block, new List());
          const slots = context.expression.inputs();
          if (slots.length !== inputs.length) throw new Error('Expected ' + slots.length + ' inputs, received ' + inputs.length + '.');
          if (slots.some(slot => !(slot instanceof InputSlotMorph) && !(slot instanceof BooleanSlotMorph))) {
            throw new Error('Test inputs must use value slots.');
          }
          slots.forEach((slot, index) => { slot.bindingID = index + 1 });
          context.emptySlots = slots.length;
          context.receiver = ide.stage;
          context.outerContext = new Context();
          context.outerContext.receiver = ide.stage;
          context.outerContext.variables.parentFrame = ide.stage.variables;
          const asSnap = value => Array.isArray(value) ? new List(value.map(asSnap)) : value;
          let remaining = 2000;
          const asJson = (value, depth = 0) => {
            if (--remaining < 0 || depth > 12) throw new Error('Reported value is too large.');
            if (value instanceof List) {
              if (value.length() > remaining) throw new Error('Reported list is too large.');
              return value.asArray().map(item => asJson(item, depth + 1));
            }
            if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
            if (typeof value === 'string' && value.length <= 4000) return value;
            throw new Error('Expected a number, text, boolean, or list as the reported result.');
          };
          ide.stopAllScripts();
          const actual = asJson(invoke(context, new List(inputs.map(asSnap)), null, 1500, 'The test timed out.', true));
          emit({type:'classroom-reply',id:data.id,actual});
        } else if (data.type === 'classroom-export') {
          await waitIdle();
          emit({type:'classroom-reply',id:data.id,xml:ide.serializer.serialize(ide.stage)});
        } else if (data.type === 'classroom-load') {
          enabled = false; sharing = false; readOnly = !!data.readOnly; applying = true;
          await waitIdle();
          ide.stopAllScripts();deviceControls.finish();
          // room exports gets reduced to one shared role
          const doc=new DOMParser().parseFromString(data.xml,'text/xml');
          const project=doc.getElementsByTagName('project')[0];
          if(!project || doc.getElementsByTagName('parsererror').length)throw new Error('Invalid shared project XML.');
          const helperDoc=new DOMParser().parseFromString(data.helpers||'<project/>','text/xml');
          const helperProject=helperDoc.getElementsByTagName('project')[0];
          const helperBlocks=helperProject && Array.from(helperProject.children).find(n=>n.tagName==='blocks');
          let globals=Array.from(project.children).find(n=>n.tagName==='blocks');
          if(!globals){globals=doc.createElement('blocks');project.appendChild(globals)}
          for(const definition of Array.from(helperBlocks?.children||[])) {
            if(!Array.from(globals.children).some(n=>n.getAttribute('s')===definition.getAttribute('s')))globals.appendChild(doc.importNode(definition,true));
          }
          const serializer=new XMLSerializer();
          const media=doc.getElementsByTagName('media')[0];
          const xml=media?.children.length ? '<snapdata>'+serializer.serializeToString(project)+serializer.serializeToString(media)+'</snapdata>' : serializer.serializeToString(project);
          await actions.openProject(xml);
          if (readOnly) {
            ide.isSmallStage = true;
            ide.stageRatio = 0.5;
            ide.fixLayout();
            ide.controlBar.stageSizeButton.refresh();
          }
          actions.lastSeen = data.version;
          version = data.version; actor = data.actor; actions.id = data.shared ? actor : ide.cloud.clientId;
          sharing = !!data.shared; blocked = !!data.initializing; outstanding = null; enabled = false;
          emit({type:'classroom-reply',id:data.id,version});
        } else if (data.type === 'classroom-actions') {
          for (const record of data.actions) {
            if (record.version <= version) continue;
            if (record.version !== version+1) throw new Error('Shared edits are out of order. Reconnect the editor.');
            await waitIdle();
            const action = record.action;
            // original ID and time stays so local action promises can resolve
            if (outstanding && action.user === actor && action.time === outstanding.time) outstanding = null;
            actions.lastSeen = version;
            ActionManager.prototype.onReceiveAction.call(actions,action);
            await waitIdle();
            version = record.version;
          }
          emit({type:'classroom-reply',id:data.id,version});
        } else if (data.type === 'classroom-enable') {
          enabled = !readOnly && !!data.enabled;
        } else if (data.type === 'classroom-reject') {
          if (outstanding) actions.onActionReject(outstanding,data.message);
          outstanding = null;
          ide.showMessage(data.message,4);
        }
      } catch (error) {
        enabled = false;
        emit({type:'classroom-reply',id:data.id,error:error.message});
      } finally {applying=false;}
    });
    emit({type:'classroom-editor-ready'});
  } catch (error) { emit({type:'classroom-editor-error',message:error.message}); }
})();
