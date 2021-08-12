import { buildFields, handleResults, isEmpty, mapArray, metadata, params, query, queryOne } from 'cassandra-core';
import { Client , QueryOptions } from 'cassandra-driver';
import { CategoryClient, Channel, channelModel, ChannelSM, getLimit, Item, ItemSM, ListResult, Playlist, playlistModel, PlaylistSM, PlaylistVideo, StringMap, Video, VideoCategory, videoModel, VideoService } from 'video-service';

export interface CategoryCollection {
  id: string;
  data: VideoCategory[];
}

export class CassandraVideoService implements VideoService {
  private readonly client: Client;
  private readonly channelId = 'channelId';
  channelFields: string[];
  channelMap: StringMap;
  playlistFields: string[];
  playlistMap: StringMap;
  videoFields: string[];
  videoMap: StringMap;
  constructor(db: Client, private categoryClient: CategoryClient) {
    this.client = db;
    const channelMeta = metadata(channelModel.attributes);
    this.channelFields = channelMeta.fields;
    this.channelMap = channelMeta.map;
    const playlistMeta = metadata(playlistModel.attributes);
    this.playlistFields = playlistMeta.fields;
    this.playlistMap = playlistMeta.map;
    const videoMeta = metadata(videoModel.attributes);
    this.videoFields = videoMeta.fields;
    this.videoMap = videoMeta.map;
  }
  getChannel(channelId: string , fields?: string[]): Promise<Channel> {
    const sql = `select ${buildFields(fields, this.channelFields)} from channel where id = ?`;
    return queryOne(this.client, sql, [channelId]);
  }
  getChannels(channelIds: string[], fields?: string[]): Promise<Channel[]> {
    if (!channelIds || channelIds.length <= 0) {
      return Promise.resolve([]);
    } else {
      const ps = params(channelIds.length);
      const s = `select ${buildFields(fields, this.channelFields)} from channel where id in (${ps.join(',')})`;
      return query<Channel>(this.client, s, channelIds).then(r => {
        return r;
      });
    }
  }
  getPlaylist(id: string, fields?: string[]): Promise<Playlist> {
    const sql = `select ${buildFields(fields, this.playlistFields)} from playlist where id = ?`;
    return queryOne(this.client, sql, [id]);
  }
  getPlaylists(ids: string[], fields?: string[]): Promise<Playlist[]> {
    if (!ids || ids.length <= 0) {
      return Promise.resolve([]);
    } else {
      const ps = params(ids.length);
      const s = `select ${buildFields(fields, this.playlistFields)} from playlist where id in (${ps.join(',')})`;
      return query<Playlist>(this.client, s, ids).then(r => {
        return r;
      });
    }
  }
  getVideo(id: string, fields?: string[], noSnippet?: boolean): Promise<Video> {
    const sql = `select ${buildFields(fields, this.videoFields)} from video where id = ?`;
    return queryOne(this.client, sql, [id]);
  }
  getVideos(ids: string[], fields?: string[], noSnippet?: boolean): Promise<Video[]> {
    if (!ids || ids.length <= 0) {
      return Promise.resolve([]);
    } else {
      const ps = params(ids.length);
      const s = `select ${buildFields(fields, this.videoFields)} from video where id in (${ps.join(',')})`;
      return query<Video>(this.client, s, ids).then(r => {
        return r;
      });
    }
  }
  getChannelPlaylists(channelId: string, max?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Playlist>> {
    max = getLimit(max);
    const options = getOption(nextPageToken, max);
    const sort = [{field: `publishedat`, reverse: true}];
    const must = [{type: 'match', field: `${this.channelId.toLowerCase()}`, value: `${channelId}`}];
    const a = {
      filter: {
        must,
      },
      sort
    };
    const queryObj = JSON.stringify(a);
    const sql = `select ${buildFields(fields, this.videoFields)} from playlist where expr(playlist_index, '${queryObj}')`;
    return this.client.execute(sql, undefined, options ).then(result => {
      return {
        list: mapArray(result.rows, this.playlistMap),
        nextPageToken:  result.pageState,
      };
    }).catch((err) => {
      console.log(err);
      return err;
    });
  }
  getPlaylistVideos(playlistId: string, max?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<PlaylistVideo>> {
    const limit = getLimit(max);
    const skip = getSkipNumber(nextPageToken);
    const query0 = `select videos from playlistVideo where id = ? `;
    return this.client.execute(query0, [playlistId], { prepare: true }).then(playlist => {
      let checkNext = false;
      if (skip + limit === playlist.rows[0].videos.length) {
        checkNext = true;
      }
      const ids = playlist.rows[0].videos.slice(skip, skip + limit);
      const queryQuestion = [];
      ids.forEach(() => {
        queryQuestion.push('?');
      });
      const query1 = `select ${buildFields(fields, this.videoFields)} from video where id in (${queryQuestion.join()})`;
      return this.client.execute(query1, ids, { prepare: true }).then(result => {
        return handleResults(result.rows, this.videoMap);
      });
    }).catch(err => {
      return err;
    });
  }
  search(sm: ItemSM, max?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Item>> {
    const limit = getLimit(max);
    const options = getOption(nextPageToken, limit);
    const objQuery = buildSearchQuery(sm, 'video', 'video_index', fields, this.videoFields);
    return this.client.execute(objQuery.query, undefined, options ).then(result => {
      return {
        list: mapArray(result.rows, this.videoMap),
        nextPageToken: result.pageState,
      };
    }).catch((err) => {
      console.log(err);
      return err;
    });
  }
  searchVideos(sm: ItemSM, max?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Item>> {
    const limit = getLimit(max);
    const options = getOption(nextPageToken, limit);
    const objQuery = buildSearchQuery(sm, 'video', 'video_index', fields, this.videoFields);
    return this.client.execute(objQuery.query, undefined, options ).then(result => {
      return {
        list: mapArray(result.rows, this.videoMap),
        nextPageToken: result.pageState,
      };
    }).catch((err) => {
      console.log(err);
      return err;
    });
  }
  searchPlaylists(sm: PlaylistSM, max?: number, nextPageToken?: string , fields?: string[]): Promise<ListResult<Playlist>> {
    max = getLimit(max);
    const options = getOption(nextPageToken, max);
    const objQuery = buildSearchQuery(sm, ' playlist', 'playlist_index', fields, this.playlistFields);
    return this.client.execute(objQuery.query, undefined, options ).then(result => {
      return {
        list: mapArray(result.rows, this.playlistMap),
        nextPageToken:  result.pageState,
      };
    }).catch((err) => {
      console.log(err);
      return err;
    });
  }
  searchChannels(sm: ChannelSM, max?: number, nextPageToken?: string , fields?: string[]): Promise<ListResult<Channel>> {
    max = getLimit(max);
    const options = getOption(nextPageToken, max);
    const objQuery = buildSearchQuery(sm, 'channel', 'channel_index', fields, this.channelFields);
    return this.client.execute(objQuery.query, undefined, options ).then(result => {
      return {
        list: mapArray(result.rows, this.channelMap),
        nextPageToken: result.pageState,
      };
    }).catch((err) => {
      console.log(err);
      return err;
    });
  }
  getRelatedVideos(videoId: string, max?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Item>> {
    max = getLimit(max);
    const options = getOption(nextPageToken, max);
    return this.getVideo(videoId).then(video => {
      if (!video) {
        const r: ListResult<Item> = { list: [] };
        return Promise.resolve(r);
      } else {
        const should = video.tags.map(item => ({type: 'contains', field: 'tags', values: item}));
        const not = [{type: 'match', field: 'id', value: videoId}];
        const sort = [{field: `publishedat`, reverse: true}];
        const queryObj = `{filter: [{should:${JSON.stringify(should)}} ${not.length > 0 ? `,{not:${JSON.stringify(not)}}` : ''}] ${sort.length > 0 ? `,sort: ${JSON.stringify(sort)}` : ''}}`;
        const sql = `select ${buildFields(fields, this.videoFields)} from video where expr(video_index, '${queryObj}')`;
        return this.client.execute(sql, undefined, options ).then(result => {
          return {
            list: mapArray(result.rows, this.videoMap),
            nextPageToken: result.pageState,
          };
        }).catch((err) => {
          console.log(err);
          return err;
        });
      }
    });
  }
  getPopularVideos(regionCode?: string, videoCategoryId?: string, max?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Video>> {
    max = getLimit(max);
    const options = getOption(nextPageToken, max);
    const sort = [{field: `publishedat`, reverse: true}];
    const queryObj = `{${sort.length > 0 ? `sort: ${JSON.stringify(sort)}` : ''}}`;
    const sql = `select ${buildFields(fields, this.videoFields)} from video where expr(video_index, '${queryObj}')`;
    return this.client.execute(sql, undefined, options ).then(result => {
      return {
        list: mapArray(result.rows, this.videoMap),
        nextPageToken: result.pageState,
      };
    }).catch((err) => {
        console.log(err);
        return err;
    });
  }
  getPopularVideosByCategory(videoCategoryId?: string, max?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Video>> {
    max = getLimit(max);
    const options = getOption(nextPageToken, max);
    const should = [{type: 'match', field: 'categoryid', value: videoCategoryId}];
    const sort = [{field: `publishedat`, reverse: true}];
    const queryObj = `{filter: [{should:${JSON.stringify(should)}}] ${sort.length > 0 ? `,sort: ${JSON.stringify(sort)}` : ''}}`;
    const sql = `select ${buildFields(fields, this.videoFields)} from video where expr(video_index, '${queryObj}')`;
    return this.client.execute(sql, undefined, options ).then(result => {
      return {
        list: mapArray(result.rows, this.videoMap),
        nextPageToken: result.pageState,
      };
    }).catch((err) => {
      console.log(err);
      return err;
    });
  }
  getPopularVideosByRegion(regionCode?: string, max?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Video>> {
    max = getLimit(max);
    const options = getOption(nextPageToken, max);
    const sort = [{field: `publishedat`, reverse: true}];
    const not = [{type: 'contains', field: 'blockedregions', values: [regionCode]}];
    let a: any;
    if (regionCode) {
      a = {
        filter: {
          not,
        },
        sort
      };
    } else {
      a = { sort };
    }
    const queryObj = JSON.stringify(a);
    const sql = `select ${buildFields(fields, this.videoFields)} from video where expr(video_index, '${queryObj}')`;
    return this.client.execute(sql, undefined, options ).then(result => {
      return {
        list: mapArray(result.rows, this.videoMap),
        nextPageToken: result.pageState,
      };
    }).catch((err) => {
      console.log(err);
      return err;
    });
  }
  getCagetories(regionCode: string): Promise<VideoCategory[]> {
    const query0 = `select * from category where id = ?`;
    return this.client.execute(query0, [regionCode], {prepare: true}).then(category => {
      if (category.rows[0]) {
        return category.rows[0];
      } else {
        return this.categoryClient.getCagetories(regionCode).then(async (r) => {
          const categoryToSave: VideoCategory[] = r.filter((item) => item.assignable === true);
          const newCategoryCollection: CategoryCollection = {
            id: regionCode,
            data: categoryToSave,
          };
          const query1 = `insert into category (id,data) values (?,?)`;
          const queries = {
            query: query1,
            params: newCategoryCollection
          };
          return this.client.batch([queries], { prepare: true }).then(() => {
            return newCategoryCollection;
          }).catch((err) => {
            console.log(err);
            return err;
          });
        });
      }
    }).catch(err => {
      console.log(err);
      return err;
    });
  }
  getChannelVideos(channelId: string, max: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<PlaylistVideo>> {
    max = getLimit(max);
    const options = getOption(nextPageToken, max);
    const should = [{type: 'match', field: 'channelid', value: channelId}];
    const sort = [{field: `publishedat`, reverse: true}];
    const queryObj = `{filter: [{should:${JSON.stringify(should)}}] ${sort.length > 0 ? `,sort: ${JSON.stringify(sort)}` : ''}}`;
    const sql = `select ${buildFields(fields, this.videoFields)} from video where expr(video_index, '${queryObj}')`;
    return this.client.execute(sql, undefined, options ).then(result => {
      return {
        list: mapArray(result.rows, this.videoMap),
        nextPageToken: result.pageState,
      };
    }).catch((err) => {
      console.log(err);
      return err;
    });
  }
}

export function getSkipNumber(nextPageToken: string): number {
  if (nextPageToken) {
    const arr = nextPageToken.toString().split('|');
    if (arr.length < 2) {
      return undefined;
    }
    if (isNaN(arr[1] as any)) {
      return 0;
    }
    const n = parseFloat(arr[1]);
    const s = n.toFixed(0);
    return parseFloat(s);
  }
  return 0;
}
export function getOption(nextPageToken: string, max?: number): QueryOptions {
  let options: QueryOptions ;
  if (!nextPageToken) {
    options = { prepare: true , fetchSize: Number(max) };
  } else {
    options = { pageState: nextPageToken , prepare: true , fetchSize: Number(max) };
  }
  return options;
}
export function buildSearchQuery(s: any , tableName: string, index: string, fields?: string[], mapFields?: string[]): any {
  const arrayKeys = Object.keys(s);
  const arrayValues = Object.values(s);
  const should = [];
  const must = [];
  const not = [];
  const sort = [];
  arrayKeys.forEach((key, i) => {
    if (key === 'q') {
      should.push({type: 'phrase', field: 'title', value: `${s.q}`});
      should.push({type: 'prefix', field: 'title', value: `${s.q}`});
      should.push({type: 'wildcard', field: 'title', value: `*${s.q}`});
      should.push({type: 'wildcard', field: 'title', value: `${s.q}*`});
      should.push({type: 'wildcard', field: 'title', value: `*${s.q}*`});
      should.push({type: 'phrase', field: 'description', value: `${s.q}`});
      should.push({type: 'prefix', field: 'description', value: `${s.q}`});
      should.push({type: 'wildcard', field: 'description', value: `*${s.q}`});
      should.push({type: 'wildcard', field: 'description', value: `${s.q}*`});
      should.push({type: 'wildcard', field: 'description', value: `*${s.q}*`});
    } else if (key === 'duration') {
      switch (s.videoDuration) {
        case 'short':
          must.push({type: 'range', field: 'duration', lower: '0', upper: '240'});
          break;
        case 'medium':
          must.push({type: 'range', field: 'duration', lower: '240', upper: '1200'});
          break;
        case 'long':
          must.push({type: 'range', field: 'duration', lower: '1200'});
          break;
        default:
          break;
      }
    } else if (key === 'publishedAfter' || key === 'publishedBefore') {
      if (s.publishedBefore && s.publishedAfter) {
        must.push({type: 'range', field: 'publishedat', lower: s.publishedBefore.toISOString().replace('T', ' '), upper: s.publishedAfter.toISOString().replace('T', ' ')});
      } else if ( s.publishedAfter) {
        must.push({type: 'range', field: 'publishedat', upper: s.publishedAfter.toISOString().replace('T', ' ')});
      } else if (s.publishedBefore) {
        must.push({type: 'range', field: 'publishedat', lower: s.publishedBefore.toISOString().replace('T', ' ')});
      }
    } else if (key === 'regionCode') {
      if (!isEmpty(s.regionCode)) {
        not.push({type: 'contains', field: 'blockedregions', values: [s.regionCode]});
      }
    } else if (key === 'sort') {
      if ( s.sort) {
        sort.push({field: `${s.sort.toLowerCase()}`, reverse: true});
      }
    } else if (key === 'channelId') {
      if ( arrayValues[i]) {
        tableName === 'channel' ? must.push({type: 'match', field: 'id', value: `${arrayValues[i]}`}) : must.push({type: 'match', field: `${key.toLowerCase()}`, value: `${arrayValues[i]}`});
      }
    } else {
      if (arrayValues[i]) {
       must.push({type: 'match', field: `${key.toLowerCase()}`, value: `${arrayValues[i]}`});
      }
    }
  });
  const a = {
    filter: {
      should,
      not,
    },
    query: must,
    sort
  };
  if (should.length === 0) {
    delete a.filter.should;
  }
  if (must.length === 0) {
    delete a.query;
  }
  if (not.length === 0) {
    delete a.filter.not;
  }
  if (sort.length === 0) {
    delete a.sort;
  }
  const queryObj = JSON.stringify(a);
  const sql = `select ${buildFields(fields, mapFields)} from ${tableName} where expr(${index}, '${queryObj}')`;
  return {
    query: sql,
    params: queryObj,
  };
}