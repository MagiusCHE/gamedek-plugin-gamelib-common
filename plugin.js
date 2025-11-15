const fs = require('fs')
const md5 = require('md5')
const mkdirp = require('mkdirp')
const path = require('path')
const rimraf = require('rimraf')
const Url = require('url');

class myplugin extends global.Plugin {
    constructor(root, manifest) {
        super(root, manifest)
    }
    #mediapath
    async init() {
        await super.init()
        this.#mediapath = path.join(kernel.appDataRoot, 'library', 'media')
        mkdirp.sync(this.#mediapath)
    }
    async libraryLoaded(library) {

        const dirs = fs.readdirSync(this.#mediapath)

        let updated = false;

        library.games.forEach(g => {
            if (!g.hash) {
                g.hash = this.generateGameHash(g)
                this.log(`Game "%s" has no hash. Recreate it = %s`, g.props.info.title, g.hash)
                updated = true;
            }
            const d = dirs.indexOf(g.hash)
            if (d > -1) {
                dirs.splice(d, 1)
            }
        })

        if (dirs.length > 0) {
            this.log(`%s directories in %s will be removed due to missing game in library.`, dirs.length, this.#mediapath)
            for (const rem of dirs) {
                const dest = path.join(this.#mediapath, rem)
                rimraf.sync(dest)
            }
        }
    }
    generateGameHash(game) {
        return md5(game.props.info.title + '§' + game.props.info.year)
    }
    async confirmGameParams(info, returns) {
        const props = info.props
        if (returns.error) {
            return returns
        }
        if (!props.info.title) {
            returns.error = {
                title: await kernel.translateBlock('${lang.ge_com_required_title}'),
                message: await kernel.translateBlock('${lang.ge_com_required "' + await kernel.translateBlock('${lang.ge_com_tabinfo_title}') + '"}'),
            }
            returns.tab = 'info'
            returns.item = 'title'
        }
        if (!props.info.year) {
            returns.error = {
                title: await kernel.translateBlock('${lang.ge_com_required_title}'),
                message: await kernel.translateBlock('${lang.ge_com_required "' + await kernel.translateBlock('${lang.ge_com_tabinfo_year}') + '"}'),
            }
            returns.tab = 'info'
            returns.item = 'year'
        }

        const hash = this.generateGameHash(info)
        const exists = await kernel.gamelist_getGameByHash(hash)

        if (info.prev_hash && hash != info.prev_hash && exists) {
            returns.error = {
                title: await kernel.translateBlock('${lang.ge_com_alreadyexists_title}'),
                message: await kernel.translateBlock('${lang.ge_com_alreadyexists}'),
            }
            returns.tab = 'info'
            returns.item = 'title'

            return returns
        } else if (info.prev_hash && hash == info.prev_hash && !exists) {
            returns.error = {
                title: await kernel.translateBlock('${lang.ge_com_notexists_title}'),
                message: await kernel.translateBlock('${lang.ge_com_notexists}'),
            }
            return returns
        }
        return returns
    }
    async updateGame(info, returns) {
        return this.createNewGame(info, returns)
    }
    async getPathbyGameHash(hash, returns) {
        if (!returns) {
            return returns
        }
        if (returns.handled) {
            return returns
        }
        returns.handled = true

        if (returns.path.indexOf('@media://') == 0) {
            const safepath = Url.fileURLToPath(returns.path.replace(/\@media\:\/\//gm, `file://${process.platform != 'win32' ? '/' : ''}`))
            returns.path = path.join(this.#mediapath, hash, safepath)
        }
        return returns
    }
    async getUrlbyGameHash(hash, returns) {
        if (!returns) {
            return returns
        }
        if (returns.handled) {
            return returns
        }
        returns.handled = true

        if (returns.path.indexOf('@media://') == 0) {
            const safepath = Url.fileURLToPath(returns.path.replace(/\@media\:\/\//gm, `file://${process.platform != 'win32' ? '/' : ''}`))
            const newpath = path.join(this.#mediapath, hash, safepath)
            let qs = ''
            if (fs.existsSync(newpath)) {
                qs = '?vt=' + fs.statSync(newpath).mtime.getTime()
            }
            returns.url = Url.pathToFileURL(newpath) + qs
        }
        return returns
    }
    async createNewGame(info, returns) {
        returns = returns || {}
        try {
            const props = info.props
            const hash = this.generateGameHash(info)

            const interalmediapath = path.join(this.#mediapath, hash)
            //internalize images
            const tointernalize = ['imagelandscape', 'imageportrait', 'icon']

            if (info.prev_hash && hash != info.prev_hash) {
                const oripath = path.join(this.#mediapath, info.prev_hash)
                if (fs.existsSync(oripath)) {
                    fs.renameSync(oripath, interalmediapath)
                    for (const toi of tointernalize) {
                        if (!props.info[toi]) {
                            continue
                        }
                        if (props.info[toi].indexOf(path.join(oripath, '/')) == 0) {
                            props.info[toi] = '@media://' + toi + path.extname(props.info[toi])
                        }
                    }
                }
            }

            //this.log(`Setting game hash %s`, hash, props.info)
            info.hash = hash

            for (const toi of tointernalize) {
                if (!props.info[toi]) {
                    continue
                }

                this.log(`Internalizing image for "%s": %s`, toi, props.info[toi])

                if (props.info[toi].indexOf('@media://') == 0) {
                    continue
                }

                if (props.info[toi].indexOf('https://') == 0) {
                    // Download image from web
                    this.log(`Downloading image from web for "%s": %s`, toi, props.info[toi])
                    try {
                        const rs = await kernel.broadcastPluginMethod('curl', 'ensureFileByUrl', props.info[toi], 'images')
                        props.info[toi] = rs.returns.last.fname
                    } catch (e) {
                        this.logError(`Error downloading image for "%s" from "%s": %s`, toi, props.info[toi], e.message)
                    }
                }

                if (!fs.existsSync(props.info[toi])) {
                    returns.error = {
                        title: await kernel.translateBlock('${lang.ge_com_filenotfound_title}'),
                        message: await kernel.translateBlock('${lang.ge_com_filenotfound "' + await kernel.translateBlock('${lang.ge_com_tabinfo_' + toi + '}') + '" "' + props.info[toi] + '"}'),
                    }
                    returns.tab = 'info'
                    returns.item = toi

                    return returns
                }

                const src = path.resolve(props.info[toi])
                const dst = path.join(interalmediapath, toi + path.extname(src))
                if (src != dst) {
                    mkdirp.sync(interalmediapath)
                    fs.copyFileSync(src, dst)
                }
                props.info[toi] = '@media://' + toi + path.extname(src)
            }
        } catch (e) {
            this.logError(`Error while saving game media: %s`, e.message)
            throw e
        }

        return returns
    }
    async convertGameInfo(gameinfo) {
        return
    }
    async queryInfoForGame(action, newargsinfo) {
        if (action.split('.')[0] != 'import') {
            return
        }
        //this.log(`Providing game info structure for action %o, Existing info:`, action, existinginfo)
        if (!newargsinfo) {
            newargsinfo = {}
        }
        if (!newargsinfo.tabs) {
            newargsinfo.tabs = {}
        }

        newargsinfo.tabs.info = {
            order: "0"
            , title: await kernel.translateBlock('${lang.ge_com_tabinfo_name}')
            , items: {
                title: {
                    type: "text"
                    , label: await kernel.translateBlock('${lang.ge_com_tabinfo_title}')
                    , required: true
                },
                imagelandscape: {
                    type: "image"
                    , label: await kernel.translateBlock('${lang.ge_com_tabinfo_imagelandscape}')
                    , note: await kernel.translateBlock('${lang.ge_com_tabinfo_imagelandscape_tip}')
                    , filters: [
                        {
                            name: await kernel.translateBlock('${lang.ge_com_tabinfo_image_flabel}')
                            , extensions: ['jpg', 'png', 'gif']
                        }
                    ]
                },
                imageportrait: {
                    type: "image"
                    , label: await kernel.translateBlock('${lang.ge_com_tabinfo_imageportrait}')
                    , note: await kernel.translateBlock('${lang.ge_com_tabinfo_imageportrait_tip}')
                    , filters: [
                        {
                            name: await kernel.translateBlock('${lang.ge_com_tabinfo_image_flabel}')
                            , extensions: ['jpg', 'png', 'gif']
                        }
                    ]
                },
                icon: {
                    type: "image"
                    , label: await kernel.translateBlock('${lang.ge_com_tabinfo_icon}')
                    , filters: [
                        {
                            name: await kernel.translateBlock('${lang.ge_com_tabinfo_image_flabel}')
                            , extensions: ['jpg', 'png', 'gif']
                        }
                    ]
                },
                year: {
                    type: "select"
                    , label: await kernel.translateBlock('${lang.ge_com_tabinfo_year}')
                },
            }
        }
        newargsinfo.tabs.system = {
            order: "1"
            , title: await kernel.translateBlock('${lang.ge_com_tabsys_name}')
            , items: {
                env: {
                    type: "keyvalue"
                    , label: await kernel.translateBlock('${lang.ge_com_tabsys_envtitle}')
                    , label_placeholder: await kernel.translateBlock('${lang.ge_com_tabsys_envlabel_ph}')
                    , item_placeholder: await kernel.translateBlock('${lang.ge_com_tabsys_envitem_ph}')
                },
            }
        }
        const yopts = {}
        //let yearSelected = false;
        for (let h = new Date().getFullYear() + 1; h >= 2000; h--) {
            if (h == new Date().getFullYear()) {
                yopts['' + h] = {
                    title: '' + h
                    , preferred: true
                }
            } else {
                yopts['' + h] = '' + h
            }
        }

        newargsinfo.tabs.info.items.year.opts = yopts
        return newargsinfo;
    }
}

module.exports = myplugin
