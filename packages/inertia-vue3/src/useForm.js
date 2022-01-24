import isEqual from 'lodash.isequal'
import { reactive, watch } from 'vue'
import cloneDeep from 'lodash.clonedeep'
import { Inertia } from '@inertiajs/inertia'
import debounce from 'lodash.debounce'

export default function useForm(...args) {
  const rememberKey = typeof args[0] === 'string' ? args[0] : null
  const data = (typeof args[0] === 'string' ? args[1] : args[0]) || {}
  const restored = rememberKey ? Inertia.restore(rememberKey) : null
  let defaults = cloneDeep(data)
  let cancelToken = null
  let recentlySuccessfulTimeoutId = null
  let transform = data => data

  let form = reactive({
    ...restored ? restored.data : data,
    isDirty: false,
    errors: restored ? restored.errors : {},
    hasErrors: false,
    processing: false,
    progress: null,
    wasSuccessful: false,
    recentlySuccessful: false,
    realtimeValidationOptions: {},
    data() {
      return Object
        .keys(data)
        .reduce((carry, key) => {
          carry[key] = this[key]
          return carry
        }, {})
    },
    transform(callback) {
      transform = callback

      return this
    },
    defaults(key, value) {
      if (typeof key === 'undefined') {
        defaults = this.data()
      } else {
        defaults = Object.assign(
          {},
          cloneDeep(defaults),
          value ? ({ [key]: value }) : key,
        )
      }

      return this
    },
    reset(...fields) {
      let clonedDefaults = cloneDeep(defaults)
      if (fields.length === 0) {
        Object.assign(this, clonedDefaults)
      } else {
        Object.assign(
          this,
          Object
            .keys(clonedDefaults)
            .filter(key => fields.includes(key))
            .reduce((carry, key) => {
              carry[key] = clonedDefaults[key]
              return carry
            }, {}),
        )
      }

      return this
    },
    setError(key, value) {
      Object.assign(this.errors, (value ? { [key]: value } : key))

      this.hasErrors = Object.keys(this.errors).length > 0

      return this
    },
    clearErrors(...fields) {
      this.errors = Object
        .keys(this.errors)
        .reduce((carry, field) => ({
          ...carry,
          ...(fields.length > 0 && !fields.includes(field) ? { [field] : this.errors[field] } : {}),
        }), {})

      this.hasErrors = Object.keys(this.errors).length > 0

      return this
    },
    submit(method, url, options = {}) {
      const data = transform(this.data())
      const _options = {
        ...options,
        onCancelToken: (token) => {
          cancelToken = token

          if (options.onCancelToken) {
            return options.onCancelToken(token)
          }
        },
        onBefore: visit => {
          this.wasSuccessful = false
          this.recentlySuccessful = false
          clearTimeout(recentlySuccessfulTimeoutId)

          if (options.onBefore) {
            return options.onBefore(visit)
          }
        },
        onStart: visit => {
          this.processing = true

          if (options.onStart) {
            return options.onStart(visit)
          }
        },
        onProgress: event => {
          this.progress = event

          if (options.onProgress) {
            return options.onProgress(event)
          }
        },
        onSuccess: async page => {
          this.processing = false
          this.progress = null
          this.clearErrors()
          this.wasSuccessful = true
          this.recentlySuccessful = true
          recentlySuccessfulTimeoutId = setTimeout(() => this.recentlySuccessful = false, 2000)

          const onSuccess = options.onSuccess ? await options.onSuccess(page) : null
          defaults = cloneDeep(this.data())
          this.isDirty = false
          return onSuccess
        },
        onError: errors => {
          this.processing = false
          this.progress = null
          this.clearErrors().setError(errors)

          if (options.onError) {
            return options.onError(errors)
          }
        },
        onCancel: () => {
          this.processing = false
          this.progress = null

          if (options.onCancel) {
            return options.onCancel()
          }
        },
        onFinish: () => {
          this.processing = false
          this.progress = null
          cancelToken = null

          if (options.onFinish) {
            return options.onFinish()
          }
        },
      }

      if (method === 'delete') {
        Inertia.delete(url, { ..._options, data  })
      } else {
        Inertia[method](url, data, _options)
      }
    },
    get(url, options) {
      this.submit('get', url, options)
    },
    post(url, options) {
      this.submit('post', url, options)
    },
    put(url, options) {
      this.submit('put', url, options)
    },
    patch(url, options) {
      this.submit('patch', url, options)
    },
    delete(url, options) {
      this.submit('delete', url, options)
    },
    cancel() {
      if (cancelToken) {
        cancelToken.cancel()
      }
    },
    __rememberable: rememberKey === null,
    __remember() {
      return { data: this.data(), errors: this.errors }
    },
    __restore(restored) {
      Object.assign(this, restored.data)
      this.setError(restored.errors)
    },
    realtimeValidation(options) {
      if(typeof options === 'object') {
        this.realtimeValidationOptions = options
      }
    }
  })

  watch(form, newValue => {
    form.isDirty = !isEqual(form.data(), defaults)
    if (rememberKey) {
      Inertia.remember(cloneDeep(newValue.__remember()), rememberKey)
    }
  }, { immediate: true, deep: true })

  const runRealtimeValidation = debounce((newValue, prevValue) => {
    // Check if realtimeValidation options are not empty.
    let optionsNotEmpty = form.realtimeValidationOptions !== {}
    // Check if realtime validation is enabled.
    let enabled = typeof form.realtimeValidationOptions.enabled == 'boolean' ? form.realtimeValidationOptions.enabled : optionsNotEmpty
    // Check if a valid method is provided.
    let method = typeof form.realtimeValidationOptions.method == 'string' && ['get', 'post', 'put', 'patch'].includes(form.realtimeValidationOptions.method) ? form.realtimeValidationOptions.method : undefined
    // Set the url.
    let url = typeof form.realtimeValidationOptions.url == 'string' ? form.realtimeValidationOptions.url : undefined
    // Set the data. The data needs to exist in the form.
    let data = form.realtimeValidationOptions.data?.length ? form.realtimeValidationOptions.data.filter((element) => Object.keys(newValue).includes(element)) : undefined
    // Check if all necessary arguments are provided.
    if (optionsNotEmpty && enabled === true && method && url && data?.length) {
      // Find the form data that has changed since last watch update.
      let changedData = data.filter((element) => newValue[element] != prevValue[element])
      // Check if the changed data is not empty.
      if(changedData?.length) {
        Inertia[method](url, {
          _realtimeValidation: true,
          ...data.reduce((carry, key) => {
            // Only set the key/value pairs that have changed.
            if(newValue[key] != prevValue[key]) carry[key] = newValue[key]
            return carry
          }, {})
        },{
          preserveState: true,
          preserveScroll: true,
          realtimeValidation: changedData,
          only: ['errors'],
          onStart: () => {
            form.processing = true
          },
          onProgress: event => {
            form.progress = event
          },
          onSuccess: () => {
            form.processing = false
            form.progress = null
            form.clearErrors(...changedData)
          },
          onError: errors => {
            form.processing = false
            form.progress = null
            form.clearErrors(...changedData).setError(errors)
          },
          onCancel: () => {
            form.processing = false
            form.progress = null
          },
          onFinish: () => {
            form.processing = false
            form.progress = null
          },
        })
      }
    }
  }, 150)
  // Watcher for realtime validation.
  watch(() => form.data(), (newValue, prevValue) => runRealtimeValidation(newValue, prevValue), { immediate: false, deep: true })

  return form
}
