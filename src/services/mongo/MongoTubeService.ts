import { Collection, Db, FilterQuery } from 'mongodb';
import { CategoryCollection, Channel, ChannelSM, getLimit, isEmpty, Item, ItemSM, ListResult, Playlist, PlaylistCollection, PlaylistSM, PlaylistVideo, Video, VideoCategory, VideoService, YoutubeClient } from '../../video-plus';
import { buildProject, findAllWithMap, findOne, findWithMap, StringMap, upsert } from './mongo';

export class MongoTubeService implements VideoService {
  private readonly id = 'id';
  private readonly channelsCollection: Collection;
  private readonly videosCollection: Collection;
  private readonly playlistCollection: Collection;
  private readonly playlistVideoCollection: Collection;
  private readonly categoryCollection: Collection;
  private readonly playlistVideoFields: string[];
  private readonly idMap: StringMap;
  constructor(db: Db, private client: YoutubeClient) {
    this.channelsCollection = db.collection('channel');
    this.playlistCollection = db.collection('playlist');
    this.videosCollection = db.collection('video');
    this.playlistVideoCollection = db.collection('playlistVideo');
    this.categoryCollection = db.collection('category');
    this.getVideo = this.getVideo.bind(this);
    this.getVideos = this.getVideos.bind(this);
    this.playlistVideoFields = ['_id', 'title', 'description', 'publishedAt', 'channelId', 'channelTitle', 'localizedTitle', 'localizedDescription', 'thumbnail', 'mediumThumbnail', 'highThumbnail', 'standardThumbnail', 'maxresThumbnail'];
    this.idMap = { id: '_id' };
  }
  getChannel(channelId: string, fields?: string[]): Promise<Channel> {
    const query: FilterQuery<any> = { _id: channelId };
    return findOne<Channel>(this.channelsCollection, query, this.id).then((c) => {
      if (c) {
        return Promise.resolve(c);
      } else {
        const q: FilterQuery<Channel> = { customUrl: channelId };
        return findOne<Channel>(this.channelsCollection, q, this.id);
      }
    });
  }
  getChannels(channelIds: string[], fields?: string[]): Promise<Channel[]> {
    const project = buildProject(fields, undefined, this.idMap, true);
    const query: FilterQuery<any> = { _id: { $in: channelIds } };
    return findAllWithMap<Channel>(this.channelsCollection, query, this.id, undefined, undefined, project);
  }
  getPlaylists(playlistIds: string[], fields?: string[]): Promise<Playlist[]> {
    const project = buildProject(fields, undefined, this.idMap, true);
    const query: FilterQuery<any> = { _id: { $in: playlistIds } };
    return findAllWithMap<Playlist>(this.playlistCollection, query, this.id, undefined, undefined, project);
  }
  getPlaylist(playlistId: string, fields?: string[]): Promise<Playlist> {
    return this.getPlaylists([playlistId], fields).then((playlists) => playlists[0]);
  }
  getChannelPlaylists(channelId: string, limit?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Playlist>> {
    const project = buildProject(fields);
    const query: FilterQuery<Playlist> = { channelId };
    const sort = { publishedAt: -1 };
    limit = getLimit(limit);
    const skip = getSkip(nextPageToken);
    return findWithMap<any>(this.playlistCollection, query, this.id, undefined, sort, limit, skip, project).then((list) => {
      return { list, nextPageToken: getNextPageToken(list, limit, skip) };
    });
  }
  getVideos(videoIds: string[], fields?: string[]): Promise<Video[]> {
    const project = buildProject(fields, undefined, this.idMap, true);
    const query: FilterQuery<any> = { _id: { $in: videoIds } };
    return findAllWithMap<Video>(this.videosCollection, query, this.id, undefined, undefined, project);
  }
  getVideo(videoId: string, fields?: string[]): Promise<Video> {
    return this.getVideos([videoId], fields).then((videos) => (videos && videos.length > 0 ? videos[0] : null));
  }
  getPlaylistVideos(playlistId: string, limit?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<PlaylistVideo>> {
    limit = getLimit(limit);
    const skip = getSkip(nextPageToken);
    const filter: FilterQuery<any> = { _id: playlistId };
    return findOne<PlaylistCollection>(this.playlistVideoCollection, filter, this.id).then((playlist) => {
      const ids = playlist.videos.slice(skip, skip + limit);
      const query: FilterQuery<any> = { _id: { $in: ids } };
      const map: StringMap = {
        id: 'id',
        videoOwnerChannelId: 'channelId',
        videoOwnerChannelTitle: 'channelTitle',
      };
      const project = buildProject(fields, this.playlistVideoFields, map);
      return findAllWithMap<PlaylistVideo>(this.videosCollection, query, this.id, map, undefined, project).then((list) => {
        const result: ListResult<PlaylistVideo> = { list };
        result.nextPageToken = getNextPageToken(list, limit, skip);
        result.total = playlist.videos.length;
        result.limit = playlist.videos.length;
        return result;
      });
    });
  }
  getChannelVideos(channelId: string, limit?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<PlaylistVideo>> {
    const query: FilterQuery<PlaylistVideo> = { channelId };
    limit = getLimit(limit);
    const skip = getSkip(nextPageToken);
    const map: StringMap = {
      id: 'id',
      videoOwnerChannelId: 'channelId',
      videoOwnerChannelTitle: 'channelTitle',
    };
    const sort = { publishedAt: -1 };
    const project = buildProject(fields, this.playlistVideoFields, map);
    return findWithMap<PlaylistVideo>(this.videosCollection, query, this.id, map, sort, limit, skip, project).then((list) => {
      return { list, nextPageToken: getNextPageToken(list, limit, skip) };
    });
  }
  getCagetories(regionCode: string): Promise<VideoCategory[]> {
    const query: FilterQuery<any> = { _id: regionCode };
    return findOne<CategoryCollection>(this.categoryCollection, query).then((category) => {
      if (category) {
        return category.data;
      } else {
        return this.client.getCagetories(regionCode).then(async (r) => {
          const categoryToSave: VideoCategory[] = r.filter((item) => item.assignable === true);
          const newCategoryCollection: CategoryCollection = {
            id: regionCode,
            data: categoryToSave,
          };
          await upsert(this.categoryCollection, newCategoryCollection, this.id);
          return categoryToSave;
        });
      }
    });
  }
  searchVideos(itemSM: ItemSM, limit?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Item>> {
    const project = buildProject(fields, undefined, this.idMap, true);
    limit = getLimit(limit);
    const skip = getSkip(nextPageToken);
    const map: StringMap = {
      date: 'publishedAt',
      relevance: 'publishedAt',
      rating: 'publishedAt',
    };
    const sort = itemSM.sort ? { [getMapField(itemSM.sort, map)]: -1 } : undefined;
    const query = buildVideoQuery(itemSM);
    return findWithMap<Item>(this.videosCollection, query, this.id, undefined, sort, limit, skip, project).then((list) => {
      return { list, nextPageToken: getNextPageToken(list, limit, skip) };
    });
  }
  search(itemSM: ItemSM, limit?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Item>> {
    const project = buildProject(fields, undefined, this.idMap, true);
    limit = getLimit(limit);
    const skip = getSkip(nextPageToken);
    const map: StringMap = {
      date: 'publishedAt',
      relevance: 'publishedAt',
      rating: 'publishedAt',
    };
    const sort = itemSM.sort ? { [getMapField(itemSM.sort, map)]: -1 } : undefined;
    const query = buildItemQuery(itemSM);
    return findWithMap<any>(this.videosCollection, query, this.id, undefined, sort, limit, skip, project).then((list) => {
      return { list, nextPageToken: getNextPageToken(list, limit, skip) };
    });
  }
  searchPlaylists(playlistSM: PlaylistSM, limit?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Playlist>> {
    const project = buildProject(fields, undefined, this.idMap, true);
    limit = getLimit(limit);
    const skip = getSkip(nextPageToken);
    const map: StringMap = {
      date: 'publishedAt',
      relevance: 'publishedAt',
      rating: 'publishedAt',
    };
    const sort = playlistSM.sort ? { [getMapField(playlistSM.sort, map)]: -1 } : undefined;
    const query = buildPlaylistQuery(playlistSM);
    return findWithMap<any>(this.playlistCollection, query, this.id, undefined, sort, limit, skip, project).then((list) => {
      return { list, nextPageToken: getNextPageToken(list, limit, skip) };
    });
  }
  searchChannels(channelSM: ChannelSM, limit?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Channel>> {
    const project = buildProject(fields, undefined, this.idMap, true);
    limit = getLimit(limit);
    const skip = getSkip(nextPageToken);
    const map: StringMap = {
      date: 'publishedAt',
      relevance: 'publishedAt',
      rating: 'publishedAt',
      viewCount: 'playlistVideoItemCount',
    };
    const sort = channelSM.sort ? { [getMapField(channelSM.sort, map)]: -1 } : undefined;
    const query = buildChannelQuery(channelSM);
    return findWithMap<any>(this.channelsCollection, query, this.id, undefined, sort, limit, skip, project).then((list) => {
      return { list, nextPageToken: getNextPageToken(list, limit, skip) };
    });
  }
  getRelatedVideos(videoId: string, limit?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Item>> {
    const project = buildProject(fields, undefined, this.idMap, true);
    limit = getLimit(limit);
    const skip = getSkip(nextPageToken);
    return this.getVideo(videoId).then((video) => {
      if (!video) {
        const r: ListResult<Item> = { list: [] };
        return Promise.resolve(r);
      } else {
        const query: FilterQuery<any> = {
          tags: { $in: video.tags },
          _id: { $nin: [videoId] },
        };
        const sort = { publishedAt: -1 };
        return findWithMap<Item>(this.videosCollection, query, this.id, undefined, sort, limit, skip, project).then((list) => {
          return { list, nextPageToken: getNextPageToken(list, limit, skip) };
        });
      }
    });
  }
  getPopularVideos(regionCode: string, videoCategoryId: string, limit?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Video>> {
    const project = buildProject(fields, undefined, this.idMap, true);
    limit = getLimit(limit);
    const skip = getSkip(nextPageToken);
    const sort = { publishedAt: -1 };
    return findWithMap<Video>(this.videosCollection, undefined, this.id, undefined, sort, limit, skip, project).then((list) => {
      return { list, nextPageToken: getNextPageToken(list, limit, skip) };
    });
  }
  getPopularVideosByCategory(categoryId: string, limit?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Video>> {
    const project = buildProject(fields, undefined, this.idMap, true);
    limit = getLimit(limit);
    const skip = getSkip(nextPageToken);
    const query: FilterQuery<Video> = { categoryId };
    const sort = { publishedAt: -1 };
    return findWithMap<Video>(this.videosCollection, query, this.id, undefined, sort, limit, skip, project).then((list) => {
      return { list, nextPageToken: getNextPageToken(list, limit, skip) };
    });
  }
  getPopularVideosByRegion(regionCode: string, limit?: number, nextPageToken?: string, fields?: string[]): Promise<ListResult<Video>> {
    const project = buildProject(fields, undefined, this.idMap, true);
    limit = getLimit(limit);
    const skip = getSkip(nextPageToken);
    const sort = { publishedAt: -1 };
    const query: FilterQuery<Video> = { blockedRegions: { $ne: regionCode } };
    return findWithMap<Video>(this.videosCollection, query, this.id, undefined, sort, limit, skip, project).then((list) => {
      return { list, nextPageToken: getNextPageToken(list, limit, skip) };
    });
  }
}

export function buildPlaylistQuery(s: PlaylistSM): FilterQuery<Playlist> {
  const query: FilterQuery<Playlist> = {};
  if (!isEmpty(s.q)) {
    query.$or = [
      {
        title: {
          $regex: `.*${s.q}.*`,
          $options: 'i',
        },
      },
      {
        description: {
          $regex: `.*${s.q}.*`,
          $options: 'i',
        },
      },
    ];
  }
  if (s.publishedBefore && s.publishedAfter) {
    query.publishedAt = { $gt: s.publishedBefore, $lte: s.publishedAfter };
  } else if (s.publishedAfter) {
    query.publishedAt = { $lte: s.publishedAfter };
  } else if (s.publishedBefore) {
    query.publishedAt = { $gt: s.publishedBefore };
  }
  if (!isEmpty(s.channelId)) {
    query.channelId = s.channelId;
  }
  if (!isEmpty(s.channelType)) {
    query.channelType = s.channelType;
  }
  if (!isEmpty(s.regionCode)) {
    query.country = s.regionCode;
  }
  if (!isEmpty(s.relevanceLanguage)) {
    query.relevanceLanguage = s.relevanceLanguage;
  }
  return query;
}
export function buildChannelQuery(s: ChannelSM): FilterQuery<Channel> {
  const query: FilterQuery<Channel> = {};
  if (!isEmpty(s.q)) {
    query.$or = [
      {
        title: {
          $regex: `.*${s.q}.*`,
          $options: 'i',
        },
      },
      {
        description: {
          $regex: `.*${s.q}.*`,
          $options: 'i',
        },
      },
    ];
  }
  if (s.publishedBefore && s.publishedAfter) {
    query.publishedAt = { $gt: s.publishedBefore, $lte: s.publishedAfter };
  } else if (s.publishedAfter) {
    query.publishedAt = { $lte: s.publishedAfter };
  } else if (s.publishedBefore) {
    query.publishedAt = { $gt: s.publishedBefore };
  }
  if (!isEmpty(s.channelId)) {
    query.channelId = s.channelId;
  }
  if (!isEmpty(s.channelType)) {
    query.channelType = s.channelType;
  }
  if (!isEmpty(s.topicId)) {
    query.topicId = s.topicId;
  }
  if (!isEmpty(s.regionCode)) {
    query.country = s.regionCode;
  }
  if (!isEmpty(s.relevanceLanguage)) {
    query.relevanceLanguage = s.relevanceLanguage;
  }
  return query;
}
export function buildItemQuery(s: ItemSM): FilterQuery<Item> {
  return buildVideoQuery(s);
}
export function buildVideoQuery(s: ItemSM): FilterQuery<Item> {
  const query: FilterQuery<Item> = {};
  if (!isEmpty(s.videoDuration)) {
    switch (s.videoDuration) {
      case 'short':
        query['duration'] = { $gt: 0, $lte: 240 };
        break;
      case 'medium':
        query['duration'] = { $gt: 240, $lte: 1200 };
        break;
      case 'long':
        query['duration'] = { $gt: 1200 };
        break;
      default:
        break;
    }
  }
  if (s.publishedBefore && s.publishedAfter) {
    query.publishedAt = { $gt: s.publishedBefore, $lte: s.publishedAfter };
  } else if (s.publishedAfter) {
    query.publishedAt = { $lte: s.publishedAfter };
  } else if (s.publishedBefore) {
    query.publishedAt = { $gt: s.publishedBefore };
  }
  if (!isEmpty(s.regionCode)) {
    query['blockedRegions'] = {
      $ne: s.regionCode,
    };
  }
  if (!isEmpty(s.q)) {
    query.$or = [
      {
        title: {
          $regex: `.*${s.q}.*`,
          $options: 'i',
        },
      },
      {
        description: {
          $regex: `.*${s.q}.*`,
          $options: 'i',
        },
      },
    ];
  }
  return query;
}

export function getMapField(name: string, map?: StringMap): string {
  if (!map) {
    return name;
  }
  const x = map[name];
  if (!x) {
    return name;
  }
  if (typeof x === 'string') {
    return x;
  }
  return name;
}

export function getNextPageToken<T>(list: T[], limit: number, skip: number, name?: string): string {
  if (!name || name.length === 0) {
    name = 'id';
  }
  if (list && list.length < limit) {
    return undefined;
  } else {
    return list && list.length > 0 ? `${list[list.length - 1][name]}|${skip + limit}` : undefined;
  }
}
export function getSkip(nextPageToken: string): number {
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
